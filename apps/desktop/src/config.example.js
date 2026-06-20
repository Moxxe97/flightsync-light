// FlightSync Light — Google OAuth "Desktop app" client (TEMPLATE).
//
// Setup: copy this file to `config.js` in this same folder and paste your own
// credentials between the quotes. `config.js` is gitignored, so your secret
// never enters version control.
//
//   cp config.example.js config.js
//
// Create the credentials in the Google Cloud console: enable the Drive API,
// configure the OAuth consent screen (non-sensitive scopes only), then create
// an OAuth client of type "Desktop app". Both values below are PUBLIC for
// installed apps — Google documents that a Desktop-client "secret" is not
// confidential and is expected to ship in the binary. While they are empty,
// cloudAuth throws "Configuration Google manquante" and the app runs fine with
// sign-in disabled.
export const GOOGLE_CLIENT_ID = '';
export const GOOGLE_CLIENT_SECRET = '';
