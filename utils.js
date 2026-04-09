/*
𝘽𝘼𝙎𝙀 𝘽𝙔 𝙅𝘼𝙈𝙀𝙎𝙏𝙀𝘾𝙃 𝙄𝙉𝘾


𝙩𝙮𝙥𝙚 : 𝙩𝙚𝙡𝙚𝙭𝙬𝙖

𝙨𝙤𝙧𝙘𝙚 : 𝙟𝙖𝙢𝙚𝙨𝙙𝙚𝙫

𝙩𝙜 : https://t.me/jamesBotz3

𝙚𝙧𝙧𝙤𝙧𝙨 𝙛𝙞𝙭 : +254704955033

𝙛𝙤𝙧 𝙢𝙤𝙧𝙚 𝙗𝙖𝙨𝙚𝙨 𝙟𝙤𝙞𝙣 𝙤𝙪𝙧 𝙩𝙚𝙡𝙚𝙜𝙧𝙖𝙢 𝙘𝙝𝙖𝙣𝙣𝙚𝙡
*/

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${d}d ${h}h ${m}m ${sec}s`;
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function cleanNumber(raw) { return raw.replace(/[^0-9]/g, ''); }
function toJid(number) { return `${cleanNumber(number)}@s.whatsapp.net`; }
function fromJid(jid) { return jid ? jid.split('@')[0].split(':')[0] : ''; }
function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
// Speed test: measure ms for a simple op
function measureSpeed() {
  const start = Date.now();
  let x = 0;
  for (let i = 0; i < 1e5; i++) x += i;
  return Date.now() - start;
}
module.exports = { formatUptime, sleep, cleanNumber, toJid, fromJid, chunk, measureSpeed };
