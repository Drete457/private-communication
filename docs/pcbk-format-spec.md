# PCBK v1 - Format Specification

## Summary

`PCBK` is the file format used for encrypted backups of the Private Communication application.
This document describes version 1 of the `.pcbk` format, including the binary layout, cryptographic algorithms, record types, the validations that writers and readers must perform, and the security guarantees that the current version is intended to provide.

The goal of this specification is to be read by humans: contributors, security auditors, and implementers of external tooling. Whenever the words `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` appear, they should be read in their normative sense.

This document defines the initial public version of the PCBK format.

## What This Document Covers

This specification covers:

1. the `.pcbk` container
2. key derivation and the cryptographic construction of the file
3. the clear header, the record layer, and the final manifest
4. the `identity-only` and `full` modes
5. the minimum validations expected from a compatible reader

This specification does not cover:

1. export or restore UX
2. optional compression before encryption
3. a universal compatibility policy across future application versions

## Design Goals

Format v1 was designed to satisfy all of these goals at the same time:

1. support small backups (`identity-only`) and complete backups (`full`)
2. keep the functional payload encrypted on the client side at all times
3. avoid giant `JSON.stringify()` payloads and base64 encoding of the main payload
4. allow incremental export in the browser
5. support large blobs without loading everything into memory at once
6. make any file modification detectable during reading
7. remain secure even if the structure of the format is public

The format does not attempt to hide all structural metadata. Record payloads are encrypted, but some framing metadata remains in cleartext to preserve streaming simplicity and validation. This is explained in more detail in [Visible Metadata in Cleartext](#visible-metadata-in-cleartext).

## Backup Modes and Data Scope

### `identity-only`

This mode contains only the exportable operational identity. In v1 it MUST contain exactly:

1. one `identity` record
2. one final `manifest` record

This mode MUST NOT include:

1. peer keys
2. messages
3. local attachments
4. remote media
5. link previews
6. outbox
7. transfer queue
8. `localStorage`
9. `sessionStorage`

### `full`

This mode represents the relevant persisted application state at the time of export. In the current implementation it includes:

1. operational identity
2. peer keys
3. messages
4. link previews
5. outbox
6. local attachments
7. transfer queue
8. remote media

Even in `full`, `localStorage` and `sessionStorage` remain outside the `.pcbk` file.

## Conventions and Terminology

### Types and Encoding

Structures encoded inside CBOR use the following notation:

1. `uint`: unsigned integer
2. `text`: UTF-8 string
3. `bstr`: CBOR byte string
4. `bool`: boolean

All CBOR structures in the format MUST use canonical CBOR. The reference implementation uses `cbor-x`, but any encoder that produces compatible canonical CBOR is valid.

### Endianness

Outside CBOR, only a few fixed-size integers exist in v1:

1. `clearHeaderLength` and `recordHeaderLength` are `uint32` little-endian
2. the suffix of the record nonce uses `uint64` big-endian

### Terms Used Throughout This Document

1. `clear header`: the CBOR map written in cleartext at the start of the file, authenticated with HMAC
2. `record header`: the CBOR map in cleartext that precedes each record ciphertext and serves as AAD
3. `rootKey`: the key derived from the passphrase via `Argon2id`
4. `headerAuthKey`: the subkey derived with `HKDF-SHA-256` to authenticate the clear header
5. `keyWrapKey`: the subkey derived with `HKDF-SHA-256` to protect the `contentKey`
6. `contentKey`: the per-backup random key used to encrypt all records
7. `backupId`: the 16-byte random identifier for the entire backup
8. `objectId`: the textual identifier used in the header of chunked records; in `remote-media-*` it MUST be opaque

## Extension, MIME Type, and File Names

The file name MUST end in `.pcbk`.

The official writer uses the MIME type `application/x-private-communication-backup` in the browser save picker. Other writers may use a different I/O mechanism, but SHOULD keep the `.pcbk` extension.

Recommended file naming pattern:

1. `private-communication-identity-YYYYMMDD-HHMMSS.pcbk`
2. `private-communication-full-YYYYMMDD-HHMMSS.pcbk`

## Cryptographic Construction

### Algorithms Fixed in v1

The algorithms fixed for format v1 are:

1. primary KDF: `Argon2id`
2. secondary derivation: `HKDF-SHA-256`
3. clear header authentication: `HMAC-SHA-256`
4. `contentKey` wrapping: `AES-GCM-256`
5. record encryption: `AES-GCM-256`
6. structured serialization: `canonical CBOR`

### Key Hierarchy

The format uses three logical key levels:

1. `rootKey`
   derived from the passphrase with `Argon2id`
2. `headerAuthKey`
   derived from `rootKey` with `HKDF-SHA-256` and `info = "PCBK/1/header-auth"`
3. `keyWrapKey`
   derived from `rootKey` with `HKDF-SHA-256` and `info = "PCBK/1/key-wrap"`
4. `contentKey`
   a 32-byte random key generated per backup and used to encrypt all records

### Passphrase Processing

In order for two implementers to derive exactly the same `rootKey`, the passphrase MUST be processed as follows:

1. normalize using Unicode `NFKC`
2. convert to UTF-8 bytes
3. use those bytes as the exact input to `Argon2id`

In compact form:

```text
rootKey = Argon2id(
  password = utf8(passphraseNFKC),
  salt = clearHeader.kdf.salt,
  memoryKiB = clearHeader.kdf.memoryKiB,
  iterations = clearHeader.kdf.iterations,
  parallelism = clearHeader.kdf.parallelism,
  hashLength = 32
)
```

### Argon2id Profiles Accepted by the Current Implementation

The profiles currently used by the official exporter are:

1. `recommended-standard`
   `memoryKiB = 131072`, `iterations = 3`, `parallelism = 1`
2. `minimum-acceptable`
   `memoryKiB = 65536`, `iterations = 3`, `parallelism = 1`
3. `controlled-fallback`
   `memoryKiB = 19456`, `iterations = 2`, `parallelism = 1`

The official exporter tries these profiles in this order. The parameters actually used MUST be written into the clear header; a reader must not assume a fixed profile.

### Current Product Passphrase Policy

This section is informative: it describes the behavior of the official exporter, not a requirement of the container itself.

Today the product accepts a manual passphrase only when:

1. the passphrase, after normalization, does not start or end with spaces
2. it does not contain control characters
3. it contains at most 256 Unicode characters
4. it contains at least 20 Unicode characters or at least 12 space-separated words
5. in the official frontend, it reaches score `4` in `zxcvbn`

The generated mode used by the application relies on a 12-word English BIP39 mnemonic. That mnemonic is a backup passphrase, not a wallet seed.

## Global File Layout

At a high level, a `.pcbk` file looks like this:

```text
+--------------------+-----------------------------------------------+
| Prelude            | Content                                       |
+--------------------+-----------------------------------------------+
| magic              | clearHeaderCbor                               |
| formatVersion      | headerAuthTag                                 |
| flags              | record 0                                      |
| clearHeaderLength  | record 1                                      |
|                    | ...                                           |
|                    | record N                                      |
+--------------------+-----------------------------------------------+
```

The fixed prelude is:

```text
offset  size  field
0       4     magic = ASCII "PCBK"
4       1     formatVersion = 0x01
5       1     flags = 0x00
6       4     clearHeaderLength (uint32 LE)
10      n     clearHeaderCbor
10+n    32    headerAuthTag
```

Mandatory rules:

1. `magic` MUST be exactly `PCBK`
2. `formatVersion` MUST be `1`
3. `flags` is reserved and MUST be `0` in v1
4. `headerAuthTag` MUST be 32 bytes long

## Clear Header

The clear header is a canonical CBOR map written in cleartext at the beginning of the file. It contains only the minimum metadata required to:

1. identify the backup mode
2. derive the key from the passphrase
3. validate that the header was not tampered with
4. unwrap the `contentKey`
5. determine how records were encrypted

Mandatory schema:

```text
{
  "headerVersion": 1,
  "mode": "identity-only" | "full",
  "createdAt": <unix epoch ms>,
  "backupId": <bstr 16>,
  "kdf": {
    "algorithm": "argon2id",
    "version": 19,
    "salt": <bstr 16>,
    "memoryKiB": <uint>,
    "iterations": <uint>,
    "parallelism": <uint>,
    "outputLength": 32
  },
  "hkdf": {
    "algorithm": "HKDF-SHA-256"
  },
  "keyWrap": {
    "algorithm": "AES-GCM-256",
    "iv": <bstr 12>,
    "wrappedContentKey": <bstr>
  },
  "recordCipher": {
    "algorithm": "AES-GCM-256",
    "noncePrefix": <bstr 4>,
    "tagLengthBits": 128
  },
  "manifest": {
    "required": true,
    "mustBeFinalRecord": true
  }
}
```

Field descriptions:

1. `headerVersion`
   the schema version of the clear header; in v1 it MUST be `1`
2. `mode`
   indicates whether the backup is `identity-only` or `full`
3. `createdAt`
   backup timestamp in Unix epoch milliseconds
4. `backupId`
   16-byte random identifier used to correlate header and manifest
5. `kdf`
   the complete `Argon2id` parameters; `version = 19` corresponds to Argon2 v1.3
6. `hkdf`
   the algorithm used to derive `headerAuthKey` and `keyWrapKey`
7. `keyWrap`
   metadata needed to decrypt the `contentKey`; `wrappedContentKey` contains the resulting AES-GCM ciphertext
8. `recordCipher`
   the algorithm and `noncePrefix` used for records
9. `manifest`
   explicitly states that the file MUST end with a `manifest` record

Fields that may appear in cleartext in the clear header:

1. `mode`
2. `createdAt`
3. `backupId`
4. `Argon2id` parameters
5. metadata required to unwrap the `contentKey`
6. `noncePrefix`

Fields that MUST NOT appear in the clear header:

1. exported identity data
2. peer keys
3. messages
4. link previews
5. outbox
6. transfer queue
7. file names, URLs, blobs, or any real data payload

## Clear Header Authentication and `contentKey` Wrapping

### `headerAuthTag`

The `headerAuthTag` authenticates the prelude plus the clear header. It is computed as follows:

1. derive `rootKey` with `Argon2id`
2. derive `headerAuthKey` with `HKDF-SHA-256`
3. compute `HMAC-SHA-256` over:
   1. `magic`
   2. `formatVersion`
   3. `flags`
   4. `clearHeaderLength`
   5. `clearHeaderCbor`

In pseudocode:

```text
headerAuthKey = HKDF-SHA-256(rootKey, info="PCBK/1/header-auth", length=32)
headerAuthTag = HMAC-SHA-256(
  key = headerAuthKey,
  data = magic || formatVersion || flags || clearHeaderLength || clearHeaderCbor
)
```

A reader MUST validate `headerAuthTag` before attempting to unwrap the `contentKey`.

### Wrapping and Unwrapping the `contentKey`

`contentKey`:

1. MUST be 32 bytes long
2. MUST be generated randomly per backup
3. MUST be protected with `AES-GCM-256` using `keyWrapKey`

`keyWrapKey` is derived as follows:

```text
keyWrapKey = HKDF-SHA-256(rootKey, info="PCBK/1/key-wrap", length=32)
```

To avoid circularity between `wrappedContentKey` and the final clear header, the AAD for wrapping does not use the final header exactly as written. Instead, it uses a canonical template referred to here as `keyWrapAadHeaderCbor`, where:

1. all fields are the same as in the final clear header
2. `keyWrap.wrappedContentKey` is replaced with an empty `bstr`

Unwrapping must be performed over these bytes:

```text
contentKey = AES-GCM-Decrypt(
  key = keyWrapKey,
  iv = clearHeader.keyWrap.iv,
  aad = magic || formatVersion || flags || keyWrapAadHeaderLength || keyWrapAadHeaderCbor,
  ciphertext = clearHeader.keyWrap.wrappedContentKey
)
```

A reader MUST reconstruct `keyWrapAadHeaderCbor` from the clear header it has read before validating the unwrap.

## Record Layer

Each file record contains a header in cleartext and an encrypted payload.

### Framing of Each Record

```text
offset   size   field
0        4      recordHeaderLength (uint32 LE)
4        n      recordHeaderCbor
4+n      m      ciphertext
```

`recordHeaderCbor` is a canonical CBOR map. It remains in cleartext and also serves as the AAD for the record `AES-GCM` payload.

Record header schema:

```text
{
  "recordVersion": 1,
  "type": <text>,
  "index": <uint>,
  "encoding": "cbor" | "bytes",
  "plainLength": <uint>,
  "cipherLength": <uint>,
  "objectId": <text>,        // optional
  "chunkIndex": <uint>,      // optional
  "chunkCount": <uint>       // optional
}
```

Mandatory rules:

1. `recordVersion` MUST be `1`
2. `index` MUST be a non-negative integer
3. `plainLength` MUST be a non-negative integer
4. `cipherLength` MUST be a non-negative integer and MUST match the actual length of the written ciphertext
5. `chunkIndex` and `chunkCount` MUST appear together; one without the other is invalid
6. when `chunkIndex` is present, `chunkCount` MUST be greater than zero and `chunkIndex < chunkCount`
7. for chunked records, `objectId` MUST be present

In v1, because records use `AES-GCM` with a 128-bit tag, the official writer sets `cipherLength` to `plainLength + 16`. A reader SHOULD validate that relationship when appropriate, but must not depend on a hardcoded value that would prevent future version evolution.

### Record Nonce

Each record uses a deterministically derived nonce:

```text
recordNonce = noncePrefix(4 bytes) || uint64be(recordIndex)
```

Rules:

1. `noncePrefix` MUST be random per backup
2. `recordIndex` MUST start at `0`
3. `recordIndex` MUST grow strictly by one
4. a reader MUST reject repeated, out-of-order, or skipped indices

### Record Payload Encryption

```text
ciphertext = AES-GCM-Encrypt(
  key = contentKey,
  iv = recordNonce,
  aad = recordHeaderCbor,
  plaintext = recordPayload
)
```

This means that any modification to `recordHeaderCbor` or to the encrypted payload must cause record authentication to fail.

## Valid Record Types in v1

The valid record types in this version are:

1. `identity`
2. `peer-keys-batch`
3. `messages-batch`
4. `link-previews-batch`
5. `outbox-batch`
6. `attachment-meta`
7. `attachment-chunk`
8. `transfer-queue-meta`
9. `transfer-queue-chunk`
10. `remote-media-meta`
11. `remote-media-chunk`
12. `manifest`

A reader that only implements v1 SHOULD reject unknown record types.

## Record Ordering

Ordering rules are part of the format:

1. `identity` MUST exist exactly once
2. `manifest` MUST be the last record in the file
3. `identity-only` MUST contain only one `identity` record and the final `manifest`
4. any type other than `identity` and `manifest` MUST appear only in `full` backups
5. each `attachment-meta` MUST appear before the first corresponding `attachment-chunk`
6. each `transfer-queue-meta` MUST appear before the first corresponding `transfer-queue-chunk`
7. each `remote-media-meta` MUST appear before the first corresponding `remote-media-chunk`
8. chunks belonging to the same object SHOULD be contiguous

## Record Payloads

All structured payloads MUST be serialized using canonical CBOR. Records with `encoding = "bytes"` carry raw bytes in the plaintext before encryption.

### `identity`

Payload:

```text
{
  "identity": <IdentityPayload>
}
```

`IdentityPayload` is the exportable operational identity of the application.

### `peer-keys-batch`

Payload:

```text
{
  "items": [<StoredPeerKey>, ...]
}
```

Each batch carries a subset of the peer keys store. Batch size is not part of the format; in the current implementation, the exporter uses batches of up to 100 items.

### `messages-batch`

Payload:

```text
{
  "items": [<DecryptedMessage>, ...]
}
```

Before export, inline attachments inside messages are sanitized to remove embedded binary data. The payload still contains the logical message structure, but blobs are stored in separate attachment records.

### `link-previews-batch`

Payload:

```text
{
  "items": [<LinkPreviewRecord>, ...]
}
```

### `outbox-batch`

Payload:

```text
{
  "items": [
    {
      "id": <text>,
      "recipientId": <text>,
      "payload": <EncryptedMessage>,
      "createdAt": <uint>,
      "lastAttemptAt": <uint|null|absent>,
      "attempts": <uint>
    },
    ...
  ]
}
```

### `attachment-meta`

This record describes an attachment before its chunks.

Payload:

```text
{
  "attachmentId": <text>,
  "peerId": <text|null>,
  "messageId": <text|null>,
  "fileName": <text>,
  "mimeType": <text>,
  "size": <uint>,
  "kind": <text|null>,
  "plaintextHashSha256": <text|null>,
  "createdAt": <uint>,
  "updatedAt": <uint>,
  "lastAccessedAt": <uint>,
  "chunkSize": <uint>,
  "chunkCount": <uint>
}
```

Additional header rules:

1. `objectId` MUST exist and, in the official exporter, matches `attachmentId`
2. `chunkIndex` and `chunkCount` do not appear in the meta header

### `attachment-chunk`

Payload:

```text
<raw chunk bytes>
```

Additional header rules:

```text
{
  "objectId": <attachmentId>,
  "chunkIndex": <uint>,
  "chunkCount": <uint>
}
```

### `transfer-queue-meta`

This record describes a transfer queue item before its file chunks.

Payload:

```text
{
  "id": <text>,
  "recipientId": <text>,
  "meta": <TransferQueueMeta>,
  "upload": <TransferQueueUpload|null>,
  "messageDispatch": <TransferQueueMessageDispatch|null>,
  "uiSource": <text|null>,
  "attachment": <MessageAttachment|null>,
  "manifest": <AttachmentManifest|null>,
  "persistLocally": <bool>,
  "status": <text>,
  "retryCount": <uint>,
  "createdAt": <uint>,
  "updatedAt": <uint>,
  "lastError": <text|null>,
  "chunkSize": <uint>,
  "chunkCount": <uint>
}
```

When the `attachment` field exists, the official exporter removes any inline `data` property before serialization.

Additional header rules:

1. `objectId` MUST exist and, in the official exporter, matches `id`

### `transfer-queue-chunk`

Payload:

```text
<raw chunk bytes>
```

Additional header rules:

```text
{
  "objectId": <transferQueueId>,
  "chunkIndex": <uint>,
  "chunkCount": <uint>
}
```

### `remote-media-meta`

This record describes a remote media object before its chunks.

Because `recordHeaderCbor` remains in cleartext, format v1 requires the `objectId` of these records to be opaque. The official exporter generates IDs of the form `media-<hex>` so that the real URL does not appear in the cleartext header.

Payload:

```text
{
  "mediaId": <text>,
  "url": <text>,
  "mimeType": <text>,
  "extension": <text>,
  "isFavorite": <bool>,
  "sourceHost": <text>,
  "peerId": <text|null>,
  "messageId": <text|null>,
  "createdAt": <uint>,
  "updatedAt": <uint>,
  "lastAccessedAt": <uint>,
  "expiresAt": <uint>,
  "chunkSize": <uint>,
  "chunkCount": <uint>
}
```

Additional rules:

1. `mediaId` SHOULD match the header `objectId`
2. the real URL MUST appear only in the encrypted payload, never in the cleartext header

### `remote-media-chunk`

Payload:

```text
<raw chunk bytes>
```

Additional header rules:

```text
{
  "objectId": <mediaId>,
  "chunkIndex": <uint>,
  "chunkCount": <uint>
}
```

### `manifest`

The `manifest` is the authenticated closing record of the file. It is encrypted like any other record, but by convention and by format rule it must be the final one.

Payload:

```text
{
  "backupId": <bstr 16>,
  "mode": "identity-only" | "full",
  "createdAt": <uint>,
  "totalRecordCount": <uint>,
  "counts": {
    "peerKeys": <uint>,
    "messages": <uint>,
    "linkPreviews": <uint>,
    "outbox": <uint>,
    "attachments": <uint>,
    "attachmentChunks": <uint>,
    "transferQueue": <uint>,
    "transferQueueChunks": <uint>,
    "remoteMedia": <uint>,
    "remoteMediaChunks": <uint>
  },
  "objects": {
    "attachments": [
      { "objectId": <text>, "chunkCount": <uint>, "size": <uint> }
    ],
    "transferQueue": [
      { "objectId": <text>, "chunkCount": <uint>, "size": <uint> }
    ],
    "remoteMedia": [
      { "objectId": <text>, "chunkCount": <uint>, "size": <uint> }
    ]
  }
}
```

Mandatory rules:

1. `totalRecordCount` MUST include the `manifest` itself
2. `backupId`, `mode`, and `createdAt` MUST match the clear header
3. absence of `manifest` MUST invalidate the file
4. `counts` only records the categories listed above; it does not include `identity` or the `manifest` itself
5. `objects` summarizes the chunked objects described by the `*-meta` records

## Behavior of the Official Exporter

This section is informative. It documents decisions made by the current implementation to help readers compare real files with the specification.

Today the official exporter:

1. uses batches of up to 100 items for `peer-keys-batch`, `messages-batch`, `link-previews-batch`, and `outbox-batch`
2. uses chunks of `256 * 1024` bytes for large blobs
3. generates `backupId`, `salt`, `wrapIv`, `noncePrefix`, and `contentKey` with fresh randomness per backup
4. tries Argon2id profiles in the order `recommended-standard`, `minimum-acceptable`, `controlled-fallback`
5. always writes `manifest` as the last record
6. requires a browser with the File System Access API for the official export flow

None of this changes the container itself except where values are materialized into the file. An alternative writer may use different batch and chunk sizes as long as it respects the rules of the format.

## Visible Metadata in Cleartext

Format v1 does not hide everything. Anyone with access to the file can observe the following in cleartext:

1. `mode`, `createdAt`, `backupId`, and the KDF parameters in the clear header
2. the number of records and their physical order
3. `type`, `index`, `encoding`, `plainLength`, and `cipherLength` for each record header
4. `objectId`, `chunkIndex`, and `chunkCount` for chunked records

Therefore, the primary guarantee of the format is confidentiality and integrity of the payload, not total concealment of structural metadata.

The format takes a few steps to reduce unnecessary leakage:

1. the clear header does not carry identity data, messages, attachments, or URLs
2. `remote-media-*` uses opaque `objectId` values so that the real URL does not appear in the header
3. message and transfer queue payloads strip inline blobs before export

## Export Algorithm

A writer conforming to v1 SHOULD follow this sequence:

1. validate the passphrase according to product policy
2. normalize the passphrase with `NFKC`
3. generate `backupId`
4. generate `salt` for Argon2id
5. derive `rootKey`
6. derive `headerAuthKey` and `keyWrapKey`
7. generate `contentKey`
8. build `keyWrapAadHeaderCbor`
9. wrap the `contentKey`
10. generate `noncePrefix`
11. serialize and write the prelude, the clear header, and the `headerAuthTag`
12. write records with ascending indices starting from `0`
13. write the `manifest` as the last record
14. close the writer

## Validations Expected from a Reader

A reader implementing v1 SHOULD, at minimum:

1. validate `magic`, `formatVersion`, and `flags`
2. read `clearHeaderLength` and `clearHeaderCbor`
3. derive `rootKey` from the user passphrase and the parameters written in the header
4. validate `headerAuthTag`
5. reconstruct `keyWrapAadHeaderCbor` and unwrap the `contentKey`
6. read records in physical file order until EOF
7. validate `recordVersion`, monotonic `index`, `cipherLength`, and `AES-GCM` authentication for each record
8. reject record types that are forbidden for the `mode` declared in the clear header
9. ensure that every `*-chunk` appears after its corresponding `*-meta`
10. ensure that `manifest` exists and is the last record
11. compare `backupId`, `mode`, `createdAt`, `totalRecordCount`, `counts`, and `objects` in the manifest with what was actually read
12. fail on truncation, reordering, record omission, modified ciphertext, tampered header, or incorrect passphrase

## Security Rules

Format v1 was designed assuming an attacker can obtain a copy of the backup file. Security depends on three pillars:

1. `Argon2id` being expensive enough to resist offline brute force
2. `AES-GCM` for record confidentiality and integrity
3. a genuinely strong passphrase

In concrete terms, v1 is intended to guarantee:

1. any change to the clear header is detected by `headerAuthTag`
2. any change to the payload or record header is detected by `AES-GCM`
3. record nonces are never reused within the same file when the `recordIndex` rule is followed
4. the parser fails in an authenticated way with an incorrect passphrase or a tampered file

V1 is not intended to guarantee:

1. total concealment of structural metadata
2. cross-version restore without additional application schema evolution rules

## Versioning and Future Evolution

There are three independent version numbers in the format:

1. `formatVersion`
   the version of the global container; in v1 it is `1`
2. `headerVersion`
   the version of the clear header schema; in v1 it is `1`
3. `recordVersion`
   the version of the record header schema; in v1 it is `1`

`flags` is reserved for future use and MUST be `0` in this version.

A v1 writer MUST emit `formatVersion = 1`, `headerVersion = 1`, `recordVersion = 1`, and `flags = 0`. A reader that only implements this version SHOULD reject any other value.

## Out of Scope

This document defines only the v1 export format. The following topics are out of scope:

1. a concrete restore implementation
2. optional compression before encryption
3. any alternative transport or sync format
