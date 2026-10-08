MILAN Android app

This project packages the production MILAN web application (https://milanlife.in/) as a native Android WebView shell.

Package: in.milanlife.android
Target SDK: 36 (Android 16)
Min SDK: 24

The GitHub Actions workflow builds:
- Debug APK for direct device testing.
- Release AAB for Google Play preparation.

The release AAB is intentionally unsigned until the owner configures a production upload key. Google Play uses Android App Bundles for store delivery. For new Play submissions from August 31, 2026, apps must target Android 16 / API 36 or higher.

Before public Play launch, configure app signing, the store listing, Data safety, content declarations, testing, and the required developer-account steps in Play Console.
