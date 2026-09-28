const fs = require('fs');
const path = require('path');
const https = require('https');

const statePath = path.join(process.env.USERPROFILE, '.expo', 'state.json');
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const token = state.auth.sessionSecret;

const req = https.request({
  hostname: 'api.expo.dev',
  path: '/graphql',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'expo-session': token
  }
}, res => {
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => console.log(body));
});

req.write(JSON.stringify({
  query: `query getBuild($id: String!) {
    appBuild(id: $id) {
      id
      status
      artifacts {
        logsUrl
      }
    }
  }`,
  variables: { id: '0f954d3b-24fc-4ae6-af5b-d27146eaf1c6' }
}));
req.end();
