// Prestataire d'horodatage RFC 3161 de test, sans réseau : une racine et un certificat d'horodatage (ECDSA P-256)
// générés à la volée, qui signent un TSTInfo pour l'empreinte demandée. Sert à produire des packs dont les ancres sont
// réellement horodatées (vérification de bout en bout par @prooflayer/verify) et à fabriquer des jetons altérés.
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { webcrypto } from "node:crypto";

const crypto = webcrypto as unknown as Crypto;
pkijs.setEngine("test-tsa", new pkijs.CryptoEngine({ name: "test-tsa", crypto }));

const TST_INFO_OID = "1.2.840.113549.1.9.16.1.4";
const SHA256_OID = "2.16.840.1.101.3.4.2.1";
export const TEST_POLICY_OID = "1.3.6.1.4.1.99999.1";

const ALG = { name: "ECDSA", namedCurve: "P-256" } as const;

function name(cn: string) {
  return new pkijs.RelativeDistinguishedNames({
    typesAndValues: [
      new pkijs.AttributeTypeAndValue({
        type: "2.5.4.3",
        value: new asn1js.Utf8String({ value: cn }),
      }),
    ],
  });
}

async function certificate(input: {
  serial: number;
  subject: string;
  issuer: string;
  publicKey: CryptoKey;
  signer: CryptoKey;
  ca: boolean;
  timestamping: boolean;
}) {
  const cert = new pkijs.Certificate();
  cert.version = 2;
  cert.serialNumber = new asn1js.Integer({ value: input.serial });
  cert.subject = name(input.subject);
  cert.issuer = name(input.issuer);
  cert.notBefore.value = new Date("2020-01-01T00:00:00Z");
  cert.notAfter.value = new Date("2045-01-01T00:00:00Z");
  cert.extensions = [
    new pkijs.Extension({
      extnID: "2.5.29.19",
      critical: true,
      extnValue: new pkijs.BasicConstraints({ cA: input.ca }).toSchema().toBER(false),
    }),
  ];
  if (input.timestamping) {
    cert.extensions.push(
      new pkijs.Extension({
        extnID: "2.5.29.37",
        critical: true,
        extnValue: new pkijs.ExtKeyUsage({ keyPurposes: ["1.3.6.1.5.5.7.3.8"] })
          .toSchema()
          .toBER(false),
      }),
    );
  }
  await cert.subjectPublicKeyInfo.importKey(input.publicKey);
  await cert.sign(input.signer, "SHA-256");
  return cert;
}

const pem = (cert: pkijs.Certificate) =>
  `-----BEGIN CERTIFICATE-----\n${Buffer.from(cert.toSchema().toBER(false))
    .toString("base64")
    .replace(/(.{64})/gu, "$1\n")
    .trim()}\n-----END CERTIFICATE-----\n`;

export interface TestTsa {
  name: string;
  /** Racine, en PEM, à épingler dans le vérificateur. */
  rootPem: string;
  /** Jeton (TimeStampToken DER) horodatant `digest` à la date `genTime`. */
  token(digest: Uint8Array, genTime?: Date): Promise<Uint8Array>;
}

/** `timestamping: false` produit un signataire sans usage d'horodatage (jeton à refuser). */
export async function createTestTsa(
  options: { name?: string; timestamping?: boolean } = {},
): Promise<TestTsa> {
  const rootKeys = (await crypto.subtle.generateKey(ALG, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const tsaKeys = (await crypto.subtle.generateKey(ALG, true, ["sign", "verify"])) as CryptoKeyPair;
  const root = await certificate({
    serial: 1,
    subject: "ProofLayer Test Root",
    issuer: "ProofLayer Test Root",
    publicKey: rootKeys.publicKey,
    signer: rootKeys.privateKey,
    ca: true,
    timestamping: false,
  });
  const signerCert = await certificate({
    serial: 2,
    subject: "ProofLayer Test TSA",
    issuer: "ProofLayer Test Root",
    publicKey: tsaKeys.publicKey,
    signer: rootKeys.privateKey,
    ca: false,
    timestamping: options.timestamping ?? true,
  });
  let serial = 100;
  return {
    name: options.name ?? "test-tsa",
    rootPem: pem(root),
    async token(digest, genTime = new Date()) {
      const tst = new pkijs.TSTInfo({
        version: 1,
        policy: TEST_POLICY_OID,
        messageImprint: new pkijs.MessageImprint({
          hashAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: SHA256_OID }),
          hashedMessage: new asn1js.OctetString({ valueHex: Uint8Array.from(digest).buffer }),
        }),
        serialNumber: new asn1js.Integer({ value: serial++ }),
        genTime,
      });
      const tstDer = tst.toSchema().toBER(false);
      const messageDigest = await crypto.subtle.digest("SHA-256", tstDer);
      const signed = new pkijs.SignedData({
        version: 3,
        encapContentInfo: new pkijs.EncapsulatedContentInfo({
          eContentType: TST_INFO_OID,
          eContent: new asn1js.OctetString({ valueHex: tstDer }),
        }),
        signerInfos: [
          new pkijs.SignerInfo({
            version: 1,
            sid: new pkijs.IssuerAndSerialNumber({
              issuer: signerCert.issuer,
              serialNumber: signerCert.serialNumber,
            }),
            signedAttrs: new pkijs.SignedAndUnsignedAttributes({
              type: 0,
              attributes: [
                new pkijs.Attribute({
                  type: "1.2.840.113549.1.9.3",
                  values: [new asn1js.ObjectIdentifier({ value: TST_INFO_OID })],
                }),
                new pkijs.Attribute({
                  type: "1.2.840.113549.1.9.4",
                  values: [new asn1js.OctetString({ valueHex: messageDigest })],
                }),
              ],
            }),
          }),
        ],
        certificates: [signerCert],
      });
      await signed.sign(tsaKeys.privateKey, 0, "SHA-256");
      const content = new pkijs.ContentInfo({
        contentType: pkijs.ContentInfo.SIGNED_DATA,
        content: signed.toSchema(true),
      });
      return new Uint8Array(content.toSchema().toBER(false));
    },
  };
}
