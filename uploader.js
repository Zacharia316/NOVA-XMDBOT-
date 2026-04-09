/*
𝘽𝘼𝙎𝙀 𝘽𝙔 𝙅𝘼𝙈𝙀𝙎𝙏𝙀𝘾𝙃 𝙄𝙉𝘾


𝙩𝙮𝙥𝙚 : 𝙩𝙚𝙡𝙚𝙭𝙬𝙖

𝙨𝙤𝙧𝙘𝙚 : 𝙟𝙖𝙢𝙚𝙨𝙙𝙚𝙫

𝙩𝙜 : https://t.me/jamesBotz3

𝙚𝙧𝙧𝙤𝙧𝙨 𝙛𝙞𝙭 : +254704955033

𝙛𝙤𝙧 𝙢𝙤𝙧𝙚 𝙗𝙖𝙨𝙚𝙨 𝙟𝙤𝙞𝙣 𝙤𝙪𝙧 𝙩𝙚𝙡𝙚𝙜𝙧𝙖𝙢 𝙘𝙝𝙖𝙣𝙣𝙚𝙡
*/


const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

/**
 * Download a file from URL to a local temp path
 */
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);
    proto.get(url, res => {
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', err => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

/**
 * Read a local file as buffer
 */
function readFileBuffer(filePath) {
  return fs.readFileSync(filePath);
}

/**
 * Get file extension from URL or filename
 */
function getExtension(filename) {
  return path.extname(filename).replace('.', '') || 'bin';
}

module.exports = { downloadFile, readFileBuffer, getExtension };
