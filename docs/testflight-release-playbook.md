# TestFlight release: API-key fallback and mandatory site check

Cross-project release memory, verified during the 2026-11-05 Neox AI internal TestFlight release. Apply only to authorized targets. The app's release plan and Apple's current policies take precedence.

## Observed incident and solution

- On Neo Master, an iOS Release archive succeeded, but export/upload using the interactive Xcode account returned "Failed to use accounts". Another release thread encountered an Xcode login blocker at about the same time.
- An existing authorized App Store Connect private key (.p8), Key ID, and Issuer ID were available. After verifying this identity through a read-only App Store Connect API request to the intended app, xcodebuild -exportArchive accepted API-key authentication and completed App Store Connect upload without interactive Xcode login.
- Upload succeeded and the official Builds API said processingState=VALID; **that did not mean the build was visible in TestFlight**. The website still displayed "Missing Compliance", and the new build was not linked to the existing internal testers group.
- Inspecting the app and the RoyalVNCKit/CryptoSwift dependency revealed standard third-party encryption in the VNC implementation. Export compliance was classified according to the actual implementation and approved distribution scope, and the exact new build was associated with the intended internal tester group. Official API read-back then confirmed internalBuildState=IN_BETA_TESTING, group linkage, and tester membership.
- Phone visibility was not verified because iPhone Mirroring was blocked. Never report phone E2E as passed based on store-side API status.

For Neox and ToyAlive, use one shared [`apple-delivery` Skill](../skills/apple-delivery/SKILL.md) and a project-owned `apple-delivery.json`. The skill CLI owns deterministic preflight, API-key signing, build number bump, upload, previously reviewed encryption classification (`ITSAppUsesNonExemptEncryption` or Apple Modify a build), and existing internal group linkage. Continue to enforce the independent website/phone verification gates below.

## Mandatory workflow for every authorized iOS/TestFlight release

1. **Preflight identity/build.** Read the repository's release policy, selected build scheme, bundle ID, Apple team, entitlements, distribution audience, and app-specific approval. Check the existing store builds first; the next CFBundleVersion must be strictly greater than prior builds. Preserve source-to-archive-to-upload identity.
2. **Try existing authorized API-key credentials before declaring Xcode login necessary.** Inspect approved local/cluster secret stores for App Store Connect .p8, Key ID, Issuer ID; validate with an official read-only endpoint for the intended app. A team API key JWT normally has an issuer claim; an individual API key may require a user subject. Never guess IDs, bypass MFA/authorization, expose secret material in logs, or commit credentials. Use Neo escalation when credential recovery is authorized but blocked.
3. **Archive, export, upload.** Xcode can use the same API key for Apple-managed signing and App Store Connect upload. Set the correct distribution method, destination, team, and intended audience in ExportOptions. The following variables must be loaded securely at runtime; none are example secrets.

       xcodebuild -project "$PROJECT" -scheme "$SCHEME" -configuration Release \
         -destination "generic/platform=iOS" -archivePath "$ARCHIVE" \
         -allowProvisioningUpdates archive

       xcodebuild -exportArchive -archivePath "$ARCHIVE" \
         -exportOptionsPlist "$EXPORT_OPTIONS" -exportPath "$EXPORT_DIR" \
         -allowProvisioningUpdates \
         -authenticationKeyPath "$APPSTORE_P8_PATH" \
         -authenticationKeyID "$APPSTORE_KEY_ID" \
         -authenticationKeyIssuerID "$APPSTORE_ISSUER_ID"

   A successful developer-signed archive is NOT evidence of correct exported distribution signing. Inspect the exported artifact/profile and actual upload receipt.
4. **Read Apple's processing result for the exact app/build.** Use official App Store Connect Builds API and/or website. Distinguish archive success, export success, transport upload success, Apple processingState=VALID, TestFlight assignment, and device availability.
5. **Mandatory POST-UPLOAD WEBSITE verification.** On the intended application's authenticated [App Store Connect](https://appstoreconnect.apple.com/apps) page, use WebHelm / the current browser skill to visit TestFlight → iOS → the **new build**. Explicitly check the visible status, "Missing Compliance"/"Manage", groups, tester count, expiration, and installation visibility. Record the actual UI result. **Do not skip this step just because an API reports VALID or Upload succeeded.** After any changes, reload the page and confirm the final state on site.
6. **Resolve compliance truthfully.** Inspect the app and bundled libraries for encryption: for example TLS, CryptoKit, CryptoSwift, VNC AES/DES, and custom algorithms. Answer Apple's encryption and distribution-country questions based on verified implementation and the actual approved release scope. Do not automatically click "None", claim absence of encryption, set an exemption flag merely to unblock release, or assume France exclusion. The build's usesNonExemptEncryption is a classification of whether *nonexempt* encryption is used; false does NOT mean "no encryption". Consult Apple documentation or escalate unclear legal/compliance cases. Recheck status on site.
7. **Assign this exact build to its authorized testers.** A group existing with older builds is insufficient. Check the internal group and its members, link the new build, and re-read the group's build list and buildBetaDetail.internalBuildState (target IN_BETA_TESTING for internal distribution). External testing may additionally require Beta App Review. Never confuse processingState=VALID with tester distribution.
8. **Check a tester device** through TestFlight for the new build number and installation/launch. If phone mirroring is unavailable, keep it as an explicit unverified gate and ask for user confirmation; do not silently mark the device test passed.
9. **Release evidence and cleanup.** Record product/commit/bundle ID, build number, archive and upload evidence, Apple API state, site verification result, compliance evidence, group linkage, beta state, tester availability, and device smoke-test state separately. Do not persist tokens, private keys, issuer IDs, or authenticated browser sessions in public documents.

## Failure routing

| Symptom | Next check |
| --- | --- |
| Xcode says "Failed to use accounts" | Verify available authorized App Store Connect API key + Issuer on the release machine/approved cluster; try xcodebuild exportArchive API-key authentication before escalating to interactive login |
| Upload succeeded, missing on phone | Inspect **website** TestFlight → iOS for Missing Compliance, processing, and tester group assignment; check official Builds API for the exact build |
| VALID, but not installable | Verify the intended beta group's **build list**, tester membership, and buildBetaDetail.internalBuildState; then check the phone's TestFlight account |
| Compliance declaration API rejects a payload | Inspect Apple's endpoint-specific constraints; a new appEncryptionDeclaration may require different conditions than setting a build's nonexempt-encryption classification |
| Phone harness is blocked | Device verification remains pending; do not reinterpret store-side checks as a successful phone E2E |

Reference: [Apple App Store Connect API](https://developer.apple.com/documentation/appstoreconnectapi), [Encryption export compliance](https://developer.apple.com/documentation/security/complying_with_encryption_export_regulations), [TestFlight](https://developer.apple.com/testflight/).
