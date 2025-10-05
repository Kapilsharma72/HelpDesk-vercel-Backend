// Script to update client environment when server starts on different port
const fs = require('fs');
const path = require('path');

const updateClientEnv = (port) => {
  try {
    const clientEnvPath = path.join(__dirname, '../client/.env');
    const envContent = `VITE_API_URL=http://localhost:${port}/api\n`;
    
    fs.writeFileSync(clientEnvPath, envContent);
    console.log(`Updated client .env file with port ${port}`);
  } catch (error) {
    console.log(`Could not update client .env file: ${error.message}`);
    console.log(`Please manually update client/.env with: VITE_API_URL=http://localhost:${port}/api`);
  }
};

module.exports = updateClientEnv;
