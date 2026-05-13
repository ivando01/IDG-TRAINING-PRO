const { OAuth2Client } = require('google-auth-library');

const client = new OAuth2Client("1046758819137-ao6ablnce565uj89bifcovh2jbfltjin.apps.googleusercontent.com");

async function verifyGoogleToken(token) {
  const ticket = await client.verifyIdToken({
    idToken: token,
    audience: "1046758819137-ao6ablnce565uj89bifcovh2jbfltjin.apps.googleusercontent.com",
  });

  return ticket.getPayload();
}

module.exports = { verifyGoogleToken };