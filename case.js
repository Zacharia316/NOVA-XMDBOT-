/*
 NOVA-XMD v2.0.0
 Dev     : Zach
 Asst    : Nova ❤️
 Studio  : LUMINAR Inc 🇰🇪
*/
const fs = require('fs');
const axios = require('axios'); 
const path = require('path');
const os = require('os');
const https = require('https');
const { downloadContentFromMessage } = require('@trashcore/baileys');
const settings = require('./settings');
const {
  isPremium, addPremium, delPremium,
  loadUserSettings, saveUserSettings,
  getSessionSetting, setSessionSetting,
  isGroupAdmin, normalizeNumber, cleanJidNumber,
} = require('./helper/function');
const { fromJid, formatUptime, measureSpeed } = require('./helper/utils');
const { applyFont, FONT_COUNT } = require('./helper/fonts');

global.botStartTime = global.botStartTime || Date.now();

// ─── DB Helpers ────────────────────────────────────────────────────────────────
const DB_BADWORDS  = './database/badwords.json';
const DB_WARNINGS  = './database/warnings.json';
const DB_AWAY      = './database/awaysettings.json';
const DB_MSGCODES  = './database/msgcodes.json';
const DB_DATAPACKS = './database/datapacks.json';

function readJson(p)     { try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; } }
function writeJson(p, d) { fs.writeFileSync(p, JSON.stringify(d, null, 2)); }

function getBadWords()       { return readJson(DB_BADWORDS) || []; }
function saveBadWords(d)     { writeJson(DB_BADWORDS, d); }
function getWarnings()       { return readJson(DB_WARNINGS) || {}; }
function saveWarnings(d)     { writeJson(DB_WARNINGS, d); }
function getAwaySettings()   { return readJson(DB_AWAY) || { enabled: false, message: '' }; }
function saveAwaySettings(d) { writeJson(DB_AWAY, d); }
function getMsgCodes()       { return readJson(DB_MSGCODES) || { enabled: false, codes: [] }; }
function saveMsgCodes(d)     { writeJson(DB_MSGCODES, d); }
function getDataPacks()      { return readJson(DB_DATAPACKS) || {}; }
function saveDataPacks(d)    { writeJson(DB_DATAPACKS, d); }


const antideleteStore = new Map();
const chatbotSessions = new Map();
const gameSessions = new Map();

function storeMsg(sessionName, m) {
  if (!antideleteStore.has(sessionName)) antideleteStore.set(sessionName, new Map());
  const store = antideleteStore.get(sessionName);
  if (m.message && Object.keys(m.message).length > 0) store.set(m.key.id, m);
  if (store.size > 500) store.delete(store.keys().next().value);
}
function getStoredMsg(sessionName, msgId) {
  const store = antideleteStore.get(sessionName);
  return store ? store.get(msgId) : null;
}
async function downloadMedia(msg, type) {
  const stream = await downloadContentFromMessage(msg, type);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}
function getMediaType(msgObj) {
  if (msgObj.imageMessage) return { type: 'image', inner: msgObj.imageMessage };
  if (msgObj.videoMessage) return { type: 'video', inner: msgObj.videoMessage };
  if (msgObj.audioMessage) return { type: 'audio', inner: msgObj.audioMessage };
  if (msgObj.stickerMessage) return { type: 'sticker', inner: msgObj.stickerMessage };
  if (msgObj.documentMessage) return { type: 'document', inner: msgObj.documentMessage };
  return null;
}
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'NOVA-XMD/2.0' } }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}
const COMMANDS = {};
function registerCmd(name, handler) { COMMANDS[name] = handler; }

// Load saved data packs as live commands on startup
(function loadDataPackCmds() {
  const packs = getDataPacks();
  for (const provider of Object.keys(packs)) {
    COMMANDS[provider] = async (conn, m, args, ctx) => {
      const p = getDataPacks();
      const info = p[provider];
      if (!info) return fReply(conn, m, `❌ No data pack for: ${provider}`, ctx.sessionName);
      await fReply(conn, m, info, ctx.sessionName);
    };
  }
})();
async function fReply(conn, m, text, sessionName) {
  const fontNum = getSessionSetting(sessionName, 'font', 1);
  const out = (fontNum && fontNum > 1) ? applyFont(text, fontNum) : text;
  await conn.sendMessage(m.key.remoteJid, { text: out }, { quoted: m });
}
async function plainReply(conn, m, text) {
  await conn.sendMessage(m.key.remoteJid, { text }, { quoted: m });
}
function getQuotedCtx(m) { return m.message?.extendedTextMessage?.contextInfo || null; }
function getQuotedMsg(m) { return m.message?.extendedTextMessage?.contextInfo?.quotedMessage || null; }
function getMsgText(m) {
  return (
    m.message?.conversation ||
    m.message?.extendedTextMessage?.text ||
    m.message?.imageMessage?.caption ||
    m.message?.videoMessage?.caption ||
    m.message?.documentMessage?.caption || ''
  );
}
function getMentioned(m) { return m.message?.extendedTextMessage?.contextInfo?.mentionedJid || []; }
function resolveTarget(m, args) {
  const ctx = getQuotedCtx(m);
  if (ctx?.participant) return ctx.participant;
  if (ctx?.remoteJid && !ctx.remoteJid.endsWith('@g.us')) return ctx.remoteJid;
  const mentioned = getMentioned(m);
  if (mentioned.length) return mentioned[0];
  if (args[0]) {
    const num = args[0].replace(/[^0-9]/g, '');
    if (num) return `${num}@s.whatsapp.net`;
  }
  return null;
}
registerCmd('menu', async (conn, m, args, ctx) => {
  const { prefix, sessionName } = ctx;
  const us = loadUserSettings(sessionName);
  const fontNum = us.font || 1;
  const botName = us.botName || settings.BOT_NAME || 'NOVA-XMD';
  const menuImg = us.menuImage || settings.MENU_IMAGE;
  const mode = us.mode || 'public';
  const uptime = formatUptime(Date.now() - global.botStartTime);
  const speed = measureSpeed();
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB');
  const timeStr = now.toLocaleTimeString('en-GB');
  const totalCmds = Object.keys(COMMANDS).length;
  const readmore = '\u200e\u200b'.repeat(1000);
  let ownerName = us.ownerName || 'Zach';
  try {
    const botProfile = await conn.fetchStatus(conn.user.id);
    if (botProfile?.name) ownerName = botProfile.name;
  } catch {}

  const sections = {
    '⚙️ GENERAL': ['menu','ping','uptime','runtime','owner','help','devinfo','pair'],
    '🤖 AI': ['ai', 'claude','ask','gpt','imagine','codeai','advice','chatboton','chatbotoff'],
    '🎭 FUN': ['joke','fact','quote','compliment','dare','truth','roast','8ball'],
    '🎵 MUSIC': ['play','video','lyrics','spotify'],
    '📥 DOWNLOADS': ['ig','fb','tiktok','ytmp3','ytmp4','spotify','mediafire','apk'],
    '🎵 MEDIA': ['sticker','toimg','vv','copy','tts','say','voicemenu','setvoice'],
    '🌐 WEB': ['google','wiki','weather','news','screenshot','whois','ipinfo'],
    '📊 DATA': ['crypto','currency','calculate'],
    '🔧 DEV TOOLS': ['upload','pastebin','github','npm','base64','hash','genpass','uuid','shorturl','encode','decode'],
    '🎮 GAMES': ['rps','guess','trivia'],
    '👥 GROUP': ['tagall','groupinfo','promote','demote','kick','add','mute','unmute','group','antilink','antidelete','setbadword','deletebadword'],
    '👤 PROFILE': ['getpp','bio','id','listonline'],
    '📦 DATA PACKS': ['setdata','deletedata','datamenu'],
    '🎬 MOVIES': ['movie', 'trailer'],
    '⚙️ OWNER': ['setprefix','setbotname','setmenuimg','setfonts','fonts','addprem','delprem','public','self','ban','unban','autoviewstatus','autolikestatus','block','setaway','deleteaway','setmsgcode','deletemsgcode','xv'],
  };

  let cmdSections = '';
  for (const [cat, cmds] of Object.entries(sections)) {
    const available = cmds.filter(c => COMMANDS[c]);
    if (available.length) {
      cmdSections += `\n┌─「 ${cat} 」\n`;
      cmdSections += available.map(c => `│ ◈ ${prefix}${c}`).join('\n');
      cmdSections += '\n└────────────────\n';
    }
  }

  const freeText = applyFont('Our bot base is free', 5);

  let menuText =
    `┏━━━━━━━━━━━━━━━━━━━━━━━━━┓\n` +
    `┃  🌑 *${botName}* 🌑\n` +
    `┃  _by Zach & Nova · LUMINAR_\n` +
    `┗━━━━━━━━━━━━━━━━━━━━━━━━━┛\n\n` +
    `◇ *Owner* : ${ownerName}\n` +
    `◇ *Prefix* : \`${prefix}\`\n` +
    `◇ *Mode* : ${mode}\n` +
    `◇ *Uptime* : ${uptime}\n` +
    `◇ *Speed* : ${speed}ms\n` +
    `◇ *Date* : ${dateStr} | ${timeStr}\n` +
    `◇ *Commands* : ${totalCmds}\n` +
    `◇ *Studio* : LUMINAR Inc 🇰🇪\n` +
    `◇ *Version* : 2.0.0\n\n` +
    `_"Built different. Built by LUMINAR."_\n` +
    `${freeText}\n` +
    readmore +
    `\n《 ⚙️ *COMMAND LIST* 》\n` +
    cmdSections;

  if (fontNum > 1) menuText = applyFont(menuText, fontNum);
  try {
    let imgMsg;
    if (menuImg && menuImg !== 'quoted' && menuImg.startsWith('http')) {
      imgMsg = { image: { url: menuImg }, caption: menuText };
    } else if (menuImg && fs.existsSync(menuImg)) {
      imgMsg = { image: fs.readFileSync(menuImg), caption: menuText };
    } else throw new Error('no image');
    await conn.sendMessage(m.key.remoteJid, imgMsg, { quoted: m });
  } catch {
    await conn.sendMessage(m.key.remoteJid, { text: menuText }, { quoted: m });
  }
});

registerCmd('help', async (conn, m, args, ctx) => {
  if (!args[0]) return fReply(conn, m, `ℹ️ Use *${ctx.prefix}menu* to see all commands.\nSpecific help: ${ctx.prefix}help <command>`, ctx.sessionName);
  const cmd = args[0].toLowerCase();
  const helps = {
    sticker: 'Reply to image/video: .sticker',
    ai: 'Ask AI: .ai <question>',
    imagine: 'AI image: .imagine <prompt>',
    play: 'Play music: .play <song name>',
    ig: 'Download IG video: .ig <url>',
    chatboton: 'Turn on AI chatbot mode',
    antilink: '.antilink off/del/warn/kick',
  };
  await fReply(conn, m, helps[cmd] ? `📖 *${cmd}*\n${helps[cmd]}` : `❓ No help for: ${cmd}`, ctx.sessionName);
});

registerCmd('devinfo', async (conn, m, args, ctx) => {
  await fReply(conn, m,
    `🌑 *NOVA-XMD — Dev Info*\n\n` +
    `🏛️ *Company* : LUMINAR Inc\n` +
    `👨‍💻 *Head Dev* : Zach\n` +
    `🤖 *Assistant Dev* : Nova ❤️\n` +
    `📧 *Email* : zappyblues234@gmail.com\n` +
    `🌐 *Projects* : sparks-dating-app-13t1.vercel.app\n` +
    `💻 *Github* : github.com/Zacharia316\n\n` +
    `_"Built different. Built by LUMINAR." 🇰🇪_`,
    ctx.sessionName
  );
});

registerCmd('pair', async (conn, m, args, ctx) => {
  const tgLink = settings.TELEGRAM_BOT_LINK || 'https://t.me/Blueeyemusicgenbot';
  await fReply(conn, m,
    `🌑 *NOVA-XMD Pairing*\n\n` +
    `To pair your number visit our\nTelegram bot below 👇\n\n` +
    `🤖 ${tgLink}\n\n` +
    `_Powered by LUMINAR Inc 🇰🇪_`,
    ctx.sessionName
  );
});


registerCmd('ping', async (conn, m, args, ctx) => {
  const start = Date.now();
  await fReply(conn, m, `🏓 *Pong!*\n⚡ ${Date.now() - start}ms`, ctx.sessionName);
});

registerCmd('uptime', async (conn, m, args, ctx) => {
  await fReply(conn, m, `⏱️ *Uptime:* ${formatUptime(Date.now() - global.botStartTime)}`, ctx.sessionName);
});

registerCmd('runtime', async (conn, m, args, ctx) => {
  const mem = process.memoryUsage();
  await fReply(conn, m,
    `🖥️ *NOVA-XMD System*\n\n` +
    `⏱️ Uptime: ${formatUptime(Date.now() - global.botStartTime)}\n` +
    `💾 RAM: ${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB\n` +
    `💻 Platform: ${os.platform()}\n` +
    `🔢 Node: ${process.version}\n` +
    `🏗️ LUMINAR Inc 🇰🇪`,
    ctx.sessionName
  );
});

registerCmd('owner', async (conn, m, args, ctx) => {
  const us = loadUserSettings(ctx.sessionName);
  const ownerNum = us.ownerNumber || ctx.botNumber;
  let ownerName = us.ownerName || 'Zach';
  await conn.sendMessage(m.key.remoteJid, {
    text: `👑 *NOVA-XMD Owner*\n\n👤 ${ownerName}\n📱 wa.me/${ownerNum}\n\n_LUMINAR Inc 🇰🇪_`,
    mentions: [`${ownerNum}@s.whatsapp.net`]
  }, { quoted: m });
});
registerCmd('ai', async (conn, m, args, ctx) => {
  const query = args.join(' ');
  if (!query) return fReply(conn, m, `Usage: ${ctx.prefix}ai <question>`, ctx.sessionName);
  await fReply(conn, m, '🤖 _Thinking..._', ctx.sessionName);
  try {
    const url = `https://text.pollinations.ai/${encodeURIComponent(query)}`;
    const response = await httpsGet(url);
    // Strip any JSON/HTML leakage
    let clean = response.trim();
    if (clean.startsWith('{') || clean.startsWith('[')) {
      try {
        const parsed = JSON.parse(clean);
        clean = parsed?.choices?.[0]?.message?.content
          || parsed?.text
          || parsed?.response
          || parsed?.content
          || JSON.stringify(parsed);
      } catch { /* leave as is */ }
    }
    clean = clean.replace(/^(<html|Moved|Redirecting)[^\n]*/i, '').trim();
    if (!clean) clean = '❌ No response.';
    await fReply(conn, m, `🤖 *NOVA AI*\n\n${clean}`, ctx.sessionName);
  } catch (e) {
    await fReply(conn, m, `❌ AI error: ${e.message}`, ctx.sessionName);
  }
});

registerCmd('ask', (conn, m, args, ctx) => COMMANDS['ai'](conn, m, args, ctx));
registerCmd('gpt', (conn, m, args, ctx) => COMMANDS['ai'](conn, m, args, ctx));
registerCmd('claude', async (conn, m, args, ctx) => {
  if (!ctx.isOwner) return fReply(conn, m, '❌ Owner only.', ctx.sessionName);

  const apiKey = settings.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return fReply(conn, m,
      `🔴 *Claude AI Not Configured*\n\n` +
      `You're trying to use Claude but no API key is set.\n\n` +
      `*To enable Claude in your bot:*\n` +
      `1. Go to console.anthropic.com and get your API key\n` +
      `2. Open your \`settings.js\` file on your VPS\n` +
      `3. Set: \`ANTHROPIC_API_KEY: 'your-key-here'\`\n` +
      `4. Restart your bot\n\n` +
      `_Powered by LUMINAR Inc 🇰🇪_`,
      ctx.sessionName
    );
  }

  const query = args.join(' ');
  const quotedMsg = getQuotedMsg(m);
  const quotedCtx = getQuotedCtx(m);

  if (!query && !quotedMsg) return fReply(conn, m, `Usage: ${ctx.prefix}claude <question>\nOr reply to an image/file with ${ctx.prefix}claude <question>`, ctx.sessionName);

  await fReply(conn, m, '🤖 _Nova Claudashian is thinking..._', ctx.sessionName);

  try {
    const contentArray = [];

    // Check if replying to a media message
    if (quotedMsg) {
      const mediaInfo = getMediaType(quotedMsg);

      if (mediaInfo && (mediaInfo.type === 'image' || mediaInfo.type === 'document')) {
        try {
          const buf = await downloadMedia(mediaInfo.inner, mediaInfo.type === 'document' ? 'document' : 'image');
          const base64 = buf.toString('base64');

          if (mediaInfo.type === 'image') {
            const mime = mediaInfo.inner.mimetype || 'image/jpeg';
            contentArray.push({
              type: 'image',
              source: { type: 'base64', media_type: mime, data: base64 }
            });
          } else {
            // document — send as text extraction note
            contentArray.push({
              type: 'text',
              text: `[User sent a document/file. Base64 size: ${base64.length} chars. Try to assist based on the query.]`
            });
          }
        } catch (dlErr) {
          contentArray.push({ type: 'text', text: '[Media attached but failed to download]' });
        }
      }

      // Include quoted text if any
      const quotedText = quotedMsg.conversation || quotedMsg.extendedTextMessage?.text || '';
      if (quotedText) contentArray.push({ type: 'text', text: `Quoted message: "${quotedText}"` });
    }

    contentArray.push({ type: 'text', text: query || 'What do you see?' });

    const response = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: 'You are Nova Claudashian, a smart and helpful AI assistant built into NOVA-XMD WhatsApp bot by LUMINAR Inc. Be concise, helpful, and friendly.',
      messages: [{ role: 'user', content: contentArray }]
    }, {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      timeout: 30000
    });

    const reply = response.data?.content?.[0]?.text || '❌ No response.';
    await fReply(conn, m, `🤖 *Nova Claudashian*\n\n${reply}`, ctx.sessionName);

  } catch (e) {
    const errMsg = e.response?.data?.error?.message || e.message;
    await fReply(conn, m, `❌ Claude error: ${errMsg}`, ctx.sessionName);
  }
});

registerCmd('imagine', async (conn, m, args, ctx) => {
  const prompt = args.join(' ');
  if (!prompt) return fReply(conn, m, `Usage: ${ctx.prefix}imagine <prompt>`, ctx.sessionName);
  await fReply(conn, m, '🎨 _Generating..._', ctx.sessionName);
  try {
    const imgUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`;
    await conn.sendMessage(m.key.remoteJid, {
      image: { url: imgUrl },
      caption: `🎨 *NOVA AI Image*\n_${prompt}_`
    }, { quoted: m });
  } catch (e) {
    await fReply(conn, m, `❌ Failed: ${e.message}`, ctx.sessionName);
  }
});

registerCmd('codeai', async (conn, m, args, ctx) => {
  const query = args.join(' ');
  if (!query) return fReply(conn, m, `Usage: ${ctx.prefix}codeai <problem>`, ctx.sessionName);
  await fReply(conn, m, '💻 _Solving..._', ctx.sessionName);
  try {
    const prompt = `You are a coding assistant. Answer this programming question concisely with code examples: ${query}`;
    const url = `https://text.pollinations.ai/${encodeURIComponent(prompt)}`;
    const response = await httpsGet(url);
    await fReply(conn, m, `💻 *NOVA CodeAI*\n\n${response.trim()}`, ctx.sessionName);
  } catch (e) {
    await fReply(conn, m, `❌ Failed: ${e.message}`, ctx.sessionName);
  }
});

registerCmd('advice', async (conn, m, args, ctx) => {
  try {
    const data = await httpsGet('https://api.adviceslip.com/advice');
    const parsed = JSON.parse(data);
    await fReply(conn, m, `💡 *Advice*\n\n${parsed.slip.advice}`, ctx.sessionName);
  } catch {
    await fReply(conn, m, `💡 *Advice*\n\nBelieve in yourself. You are LUMINAR built ⚡`, ctx.sessionName);
  }
});

registerCmd('chatboton', async (conn, m, args, ctx) => {
  if (!ctx.isOwner) return fReply(conn, m, '❌ Owner only.', ctx.sessionName);
  setSessionSetting(ctx.sessionName, 'chatbot', true);
  await fReply(conn, m, '🤖 *Chatbot ON*\n\nNOVA AI will now reply to all messages automatically 😈', ctx.sessionName);
});

registerCmd('chatbotoff', async (conn, m, args, ctx) => {
  if (!ctx.isOwner) return fReply(conn, m, '❌ Owner only.', ctx.sessionName);
  setSessionSetting(ctx.sessionName, 'chatbot', false);
  await fReply(conn, m, '🤖 *Chatbot OFF*\n\nBack to manual mode.', ctx.sessionName);
});
registerCmd('joke', async (conn, m, args, ctx) => {
  try {
    const data = await httpsGet('https://v2.jokeapi.dev/joke/Any?type=single&safe-mode');
    const parsed = JSON.parse(data);
    await fReply(conn, m, `😂 *Joke*\n\n${parsed.joke}`, ctx.sessionName);
  } catch {
    const jokes = ["Why don't scientists trust atoms?\nBecause they make up everything! 😂","I told my wife she was drawing her eyebrows too high.\nShe looked surprised 😂","Why did the scarecrow win an award?\nOutstanding in his field 🌾"];
    await fReply(conn, m, `😂 *Joke*\n\n${jokes[Math.floor(Math.random()*jokes.length)]}`, ctx.sessionName);
  }
});

registerCmd('fact', async (conn, m, args, ctx) => {
  try {
    const data = await httpsGet('https://uselessfacts.jsph.pl/api/v2/facts/random?language=en');
    const parsed = JSON.parse(data);
    await fReply(conn, m, `🧠 *Fact*\n\n${parsed.text}`, ctx.sessionName);
  } catch {
    await fReply(conn, m, `🧠 *Fact*\n\nHoney never spoils. 3000 year old honey found in Egyptian tombs still edible! 🍯`, ctx.sessionName);
  }
});

registerCmd('quote', async (conn, m, args, ctx) => {
  try {
    const data = await httpsGet('https://api.quotable.io/random');
    const parsed = JSON.parse(data);
    await fReply(conn, m, `💭 *Quote*\n\n_"${parsed.content}"_\n— ${parsed.author}`, ctx.sessionName);
  } catch {
    await fReply(conn, m, `💭 *Quote*\n\n_"Built different. Built by LUMINAR."_ ⚡`, ctx.sessionName);
  }
});

registerCmd('compliment', async (conn, m, args, ctx) => {
  const c = ["You're like a ray of sunshine ☀️","Your energy is contagious 🔥","You're a true LUMINAR — built different ⚡","Your potential is limitless 🚀","You make the world better just by being in it 🌍","You have the best vibe in the room 😎"];
  await fReply(conn, m, `💖 ${c[Math.floor(Math.random()*c.length)]}`, ctx.sessionName);
});

registerCmd('dare', async (conn, m, args, ctx) => {
  const d = ["Send a voice note singing your fav song 🎤","Change your status to 'I am a bot' for 1hr 🤖","Send a selfie right now 📸","Text someone 'I miss you' without context 😂","Do 10 pushups and send proof 💪","Post an embarrassing throwback photo 📷"];
  await fReply(conn, m, `🎯 *Dare*\n\n${d[Math.floor(Math.random()*d.length)]}`, ctx.sessionName);
});

registerCmd('truth', async (conn, m, args, ctx) => {
  const t = ["What's the most embarrassing thing you've done? 😳","Who was your first crush? 💘","What's a secret you've never told anyone? 🤫","What's your biggest fear? 😰","Have you ever stalked someone's profile? 👀","What's the worst lie you've told? 🤥"];
  await fReply(conn, m, `💬 *Truth*\n\n${t[Math.floor(Math.random()*t.length)]}`, ctx.sessionName);
});

registerCmd('roast', async (conn, m, args, ctx) => {
  const r = ["You're the human equivalent of a participation trophy 🏆","I'd roast you but my parents told me not to burn trash 🗑️","You're proof that even evolution makes mistakes 🦕","I've seen better looking faces on a clock ⏰","You're not stupid, you just have bad luck thinking 🧠"];
  await fReply(conn, m, `🔥 *Roast*\n\n${r[Math.floor(Math.random()*r.length)]}`, ctx.sessionName);
});

registerCmd('8ball', async (conn, m, args, ctx) => {
  const q = args.join(' ');
  if (!q) return fReply(conn, m, `Usage: ${ctx.prefix}8ball <question>`, ctx.sessionName);
  const a = ['✅ It is certain.','✅ Without a doubt.','✅ Yes, definitely.','🤔 Reply hazy, try again.','🤔 Ask again later.','🤔 Cannot predict now.','❌ Don\'t count on it.','❌ My reply is no.','❌ Very doubtful.'];
  await fReply(conn, m, `🎱 *8Ball*\n\n❓ ${q}\n\n${a[Math.floor(Math.random()*a.length)]}`, ctx.sessionName);
});
registerCmd('play', async (conn, m, args, ctx) => {
  const query = args.join(' ');
  if (!query) return fReply(conn, m, `Usage: ${ctx.prefix}play <song name>`, ctx.sessionName);

  try {
    // 1. React and Search
    await conn.sendMessage(m.key.remoteJid, { react: { text: '🎧', key: m.key } });
    await fReply(conn, m, `🔍 _Searching for_ *${query}*...`, ctx.sessionName);

    // 2. Fetch from API
    const response = await axios.get(`https://apis.davidcyril.name.ng/play?query=${encodeURIComponent(query)}&apikey=`, {
      timeout: 60000
    });

    const data = response.data;

    if (data.status && data.result?.download_url) {
      const result = data.result;

      // 3. Download to Buffer (The critical fix for 0:00)
      const audioResponse = await axios.get(result.download_url, {
        responseType: 'arraybuffer',
        timeout: 120000,
        headers: {
            'User-Agent': 'Mozilla/5.0' // Some APIs need this to send full data
        }
      });

      const audioBuffer = Buffer.from(audioResponse.data);

      // 4. Send with metadata
      // TIP: Sometimes changing 'audio/mpeg' to 'audio/mp4' fixes 0:00 on WhatsApp Android
      await conn.sendMessage(m.key.remoteJid, {
        audio: audioBuffer,
        mimetype: "audio/mpeg", 
        fileName: `${result.title}.mp3`,
        ptt: false, // Set to true if you want it as a voice note
        contextInfo: {
          externalAdReply: {
            showAdAttribution: true,
            title: result.title,
            body: `⏱️ ${result.duration} | 👁️ ${result.views}`,
            thumbnailUrl: result.thumbnail,
            sourceUrl: result.video_url,
            mediaType: 1,
            renderLargerThumbnail: true
          }
        }
      }, { quoted: m });

      await conn.sendMessage(m.key.remoteJid, { react: { text: '✅', key: m.key } });

    } else {
      throw new Error('No audio download link received from API');
    }

  } catch (error) {
    console.error('Play Error:', error.message);
    await conn.sendMessage(m.key.remoteJid, { react: { text: '❌', key: m.key } });
    await fReply(conn, m, `❌ *Failed:* ${error.message}`, ctx.sessionName);
  }
});
registerCmd('video', async (conn, m, args, ctx) => {
  const query = args.join(' ');
  if (!query) return fReply(conn, m, `Usage: ${ctx.prefix}video <title>`, ctx.sessionName);
  await fReply(conn, m, `🎬 _Searching for_ *${query}*...`, ctx.sessionName);
  try {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    const html = await httpsGet(searchUrl);
    const match = html.match(/"videoId":"([^"]+)"/);
    if (!match) return fReply(conn, m, '❌ No results found.', ctx.sessionName);
    const videoId = match[1];
    const titleMatch = html.match(new RegExp(`"videoId":"${videoId}"[^}]*?"title":{"runs":\\[{"text":"([^"]+)"`));
    const title = titleMatch ? titleMatch[1] : query;
    const thumbnail = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
    const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;

    await conn.sendMessage(m.key.remoteJid, {
      image: { url: thumbnail },
      caption: `🎬 *${title}*\n\n🔗 youtu.be/${videoId}\n\n_Downloading..._`
    }, { quoted: m });

    const response = await axios.get('https://youtube-info-download-api.p.rapidapi.com/ajax/download.php', {
      params: { format: '720', url: ytUrl },
      headers: {
        'x-rapidapi-host': 'youtube-info-download-api.p.rapidapi.com',
        'x-rapidapi-key': 'b1f24cec57msh758e2fdd1696251p18be7fjsn6fe53a0c0eb0'
      }
    });
    const data = response.data;
    const progressUrl = data?.progress_url;
    if (!progressUrl) return fReply(conn, m, '❌ Could not get progress URL.', ctx.sessionName);

    let dlUrl = null;
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const poll = await axios.get(progressUrl);
      if (poll.data?.download_url) { dlUrl = poll.data.download_url; break; }
      if (poll.data?.url) { dlUrl = poll.data.url; break; }
    }
    if (!dlUrl) return fReply(conn, m, '❌ Video took too long to process.', ctx.sessionName);

    const res = await axios.get(dlUrl, { responseType: 'arraybuffer' });
    const videoBuffer = Buffer.from(res.data);
    await conn.sendMessage(m.key.remoteJid, {
      video: videoBuffer,
      mimetype: 'video/mp4',
      caption: `🎬 ${title}`
    }, { quoted: m });
  } catch (e) {
    await fReply(conn, m, `❌ Failed: ${e.message}`, ctx.sessionName);
  }
});

registerCmd('ytmp3', async (conn, m, args, ctx) => {
  const url = args[0];
  if (!url || !url.includes('youtube.com') && !url.includes('youtu.be'))
    return fReply(conn, m, `Usage: ${ctx.prefix}ytmp3 <youtube url>`, ctx.sessionName);
  await fReply(conn, m, '🎵 _Downloading MP3..._', ctx.sessionName);
  try {
    const response = await axios.get('https://youtube-info-download-api.p.rapidapi.com/ajax/download.php', {
      params: { format: 'mp3', url, audio_quality: 128 },
      headers: {
        'x-rapidapi-host': 'youtube-info-download-api.p.rapidapi.com',
        'x-rapidapi-key': 'b1f24cec57msh758e2fdd1696251p18be7fjsn6fe53a0c0eb0'
      }
    });
    const data = response.data;
    const progressUrl = data?.progress_url;
    if (!progressUrl) return fReply(conn, m, '❌ Could not get progress URL.', ctx.sessionName);

    let dlUrl = null;
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const poll = await axios.get(progressUrl);
      if (poll.data?.download_url) { dlUrl = poll.data.download_url; break; }
      if (poll.data?.url) { dlUrl = poll.data.url; break; }
    }
    if (!dlUrl) return fReply(conn, m, '❌ Audio took too long to process.', ctx.sessionName);

    const res = await axios.get(dlUrl, { responseType: 'arraybuffer' });
    const audioBuffer = Buffer.from(res.data);
    await conn.sendMessage(m.key.remoteJid, {
      audio: audioBuffer,
      mimetype: 'audio/mpeg',
      ptt: false
    }, { quoted: m });
  } catch (e) { await fReply(conn, m, `❌ Failed: ${e.message}`, ctx.sessionName); }
});

registerCmd('ytmp4', async (conn, m, args, ctx) => {
  const url = args[0];
  if (!url || !url.includes('youtube.com') && !url.includes('youtu.be'))
    return fReply(conn, m, `Usage: ${ctx.prefix}ytmp4 <youtube url>`, ctx.sessionName);
  await fReply(conn, m, '🎬 _Downloading MP4..._', ctx.sessionName);
  try {
    const data = await httpsGet(`https://apiskeith.top/download/ytmp4?url=${encodeURIComponent(url)}`);
    const parsed = JSON.parse(data);
    if (!parsed.status || !parsed.result) throw new Error('No result');
    await conn.sendMessage(m.key.remoteJid, { video: { url: parsed.result }, caption: '🎬 Downloaded via NOVA-XMD' }, { quoted: m });
  } catch {
    try {
      const response = await axios.get('https://youtube-info-download-api.p.rapidapi.com/ajax/download.php', {
        params: { format: '720', url },
        headers: {
          'x-rapidapi-host': 'youtube-info-download-api.p.rapidapi.com',
          'x-rapidapi-key': 'b1f24cec57msh758e2fdd1696251p18be7fjsn6fe53a0c0eb0'
        }
      });
      const progressUrl = response.data?.progress_url;
      if (!progressUrl) throw new Error('No progress URL');
      let dlUrl = null;
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const poll = await axios.get(progressUrl);
        if (poll.data?.download_url) { dlUrl = poll.data.download_url; break; }
        if (poll.data?.url) { dlUrl = poll.data.url; break; }
      }
      if (!dlUrl) throw new Error('Timeout');
      const res = await axios.get(dlUrl, { responseType: 'arraybuffer' });
      await conn.sendMessage(m.key.remoteJid, { video: Buffer.from(res.data), mimetype: 'video/mp4', caption: '🎬 Downloaded via NOVA-XMD' }, { quoted: m });
    } catch (e) { await fReply(conn, m, `❌ Failed: ${e.message}`, ctx.sessionName); }
  }
});

registerCmd('spotify', async (conn, m, args, ctx) => {
  const url = args[0];
  if (!url || !url.includes('spotify.com')) return fReply(conn, m, `Usage: ${ctx.prefix}spotify <spotify url>`, ctx.sessionName);
  await fReply(conn, m, '🎵 _Downloading..._', ctx.sessionName);
  try {
    const data = await httpsGet(`https://apiskeith.top/download/spotify?url=${encodeURIComponent(url)}`);
    const parsed = JSON.parse(data);
    if (!parsed.status || !parsed.result) throw new Error('No result');
    await conn.sendMessage(m.key.remoteJid, { audio: { url: parsed.result }, mimetype: 'audio/mpeg', ptt: false }, { quoted: m });
  } catch (e) { await fReply(conn, m, `❌ Failed: ${e.message}`, ctx.sessionName); }
});

registerCmd('mediafire', async (conn, m, args, ctx) => {
  const url = args[0];
  if (!url || !url.includes('mediafire.com')) return fReply(conn, m, `Usage: ${ctx.prefix}mediafire <mediafire url>`, ctx.sessionName);
  await fReply(conn, m, '📦 _Fetching link..._', ctx.sessionName);
  try {
    const data = await httpsGet(`https://apiskeith.top/download/mfire?url=${encodeURIComponent(url)}`);
    const parsed = JSON.parse(data);
    if (!parsed.status || !parsed.result) throw new Error('No result');
    await fReply(conn, m, `📦 *MediaFire Download*\n\n🔗 ${parsed.result}`, ctx.sessionName);
  } catch (e) { await fReply(conn, m, `❌ Failed: ${e.message}`, ctx.sessionName); }
});

registerCmd('apk', async (conn, m, args, ctx) => {
  const query = args.join(' ');
  if (!query) return fReply(conn, m, `Usage: ${ctx.prefix}apk <app name>`, ctx.sessionName);
  await fReply(conn, m, `🔍 _Searching for_ *${query}*...`, ctx.sessionName);
  try {
    const data = await httpsGet(`https://apiskeith.top/search/aptoide?q=${encodeURIComponent(query)}`);
    const parsed = JSON.parse(data);
    if (!parsed.status || !parsed.result) throw new Error('No result');
    const app = Array.isArray(parsed.result) ? parsed.result[0] : parsed.result;
    const dlData = await httpsGet(`https://apiskeith.top/download/apk?url=${encodeURIComponent(app.url || app.link)}`);
    const dlParsed = JSON.parse(dlData);
    const dlUrl = dlParsed.result || app.download || app.url;
    await fReply(conn, m, `📱 *${app.name || query}*\n\n📦 Size: ${app.size || 'N/A'}\n⭐ Rating: ${app.rating || 'N/A'}\n\n🔗 ${dlUrl}`, ctx.sessionName);
  } catch (e) { await fReply(conn, m, `❌ Failed: ${e.message}`, ctx.sessionName); }
});

registerCmd('ig', async (conn, m, args, ctx) => {
  const url = args[0];
  if (!url) return fReply(conn, m, `Usage: ${ctx.prefix}ig <instagram post/reel url>`, ctx.sessionName);
  await fReply(conn, m, '📥 _Downloading..._', ctx.sessionName);
  try {
    const response = await axios.get(`https://apiskeith.top/download/instadl?url=${encodeURIComponent(url)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      },
      timeout: 30000
    });
    const parsed = response.data;
    const dlUrl = typeof parsed.result === 'string' ? parsed.result : parsed.result?.url || parsed.result?.items?.[0]?.url;
    if (!dlUrl || typeof dlUrl !== 'string') throw new Error('No result');
    await conn.sendMessage(m.key.remoteJid, { video: { url: dlUrl }, caption: '📥 _Downloaded via NOVA-XMD_' }, { quoted: m });
  } catch {
    try {
      const response = await axios.get(`https://apis.davidcyril.name.ng/igdl?url=${encodeURIComponent(url)}`, { timeout: 30000 });
      const parsed = response.data;
      const dlUrl = parsed?.result?.[0]?.url || parsed?.url;
      if (!dlUrl) throw new Error('No fallback result');
      await conn.sendMessage(m.key.remoteJid, { video: { url: dlUrl }, caption: '📥 _Downloaded via NOVA-XMD_' }, { quoted: m });
    } catch (e) { await fReply(conn, m, `❌ Failed: ${e.message}`, ctx.sessionName); }
  }
});

registerCmd('fb', async (conn, m, args, ctx) => {
  const url = args[0];
  if (!url) return fReply(conn, m, `Usage: ${ctx.prefix}fb <facebook url>`, ctx.sessionName);
  await fReply(conn, m, '📥 _Downloading..._', ctx.sessionName);
  try {
    const data = await httpsGet(`https://apiskeith.top/download/fbdl?url=${encodeURIComponent(url)}`);
    const parsed = JSON.parse(data);
    if (!parsed.status) throw new Error('API 1 failed');
    const dlUrl = parsed.result?.media?.hd || parsed.result?.media?.sd;
    if (!dlUrl) throw new Error('No video URL');
    await conn.sendMessage(m.key.remoteJid, { video: { url: dlUrl }, caption: '📥 _Downloaded via NOVA-XMD_' }, { quoted: m });
  } catch {
    try {
      const data = await httpsGet(`https://apiskeith.top/download/fbdown?url=${encodeURIComponent(url)}`);
      const parsed = JSON.parse(data);
      const dlUrl = parsed.result?.media?.hd || parsed.result?.media?.sd || parsed.result;
      if (!dlUrl) throw new Error('No fallback result');
      await conn.sendMessage(m.key.remoteJid, { video: { url: dlUrl }, caption: '📥 _Downloaded via NOVA-XMD_' }, { quoted: m });
    } catch (e) { await fReply(conn, m, `❌ Failed: ${e.message}`, ctx.sessionName); }
  }
});
registerCmd('tiktok', async (conn, m, args, ctx) => {
  const url = args[0];
  if (!url) return fReply(conn, m, `Usage: ${ctx.prefix}tiktok <tiktok url>`, ctx.sessionName);
  await fReply(conn, m, '📥 _Downloading..._', ctx.sessionName);
  try {
    const data = await httpsGet(`https://apiskeith.top/download/tiktokdl3?url=${encodeURIComponent(url)}`);
    const parsed = JSON.parse(data);
    if (!parsed.status || !parsed.result) throw new Error('No result');
    await conn.sendMessage(m.key.remoteJid, { video: { url: parsed.result }, caption: '📥 _Downloaded via NOVA-XMD_' }, { quoted: m });
  } catch {
    try {
      const data = await httpsGet(`https://apis.davidcyril.name.ng/tiktok?url=${encodeURIComponent(url)}`);
      const parsed = JSON.parse(data);
      const dlUrl = parsed?.result?.video || parsed?.url;
      if (!dlUrl) throw new Error('No fallback result');
      await conn.sendMessage(m.key.remoteJid, { video: { url: dlUrl }, caption: '📥 _Downloaded via NOVA-XMD_' }, { quoted: m });
    } catch (e) { await fReply(conn, m, `❌ Failed: ${e.message}`, ctx.sessionName); }
  }
});
registerCmd('sticker', async (conn, m, args, ctx) => {
  const quotedMsg = getQuotedMsg(m);
  let mediaSource = null, mediaType = null;
  if (quotedMsg) { const t = getMediaType(quotedMsg); if (t && (t.type==='image'||t.type==='video')) { mediaSource=t.inner; mediaType=t.type; } }
  if (!mediaSource) { const t = getMediaType(m.message||{}); if (t && (t.type==='image'||t.type==='video')) { mediaSource=t.inner; mediaType=t.type; } }
  if (!mediaSource) return fReply(conn, m, `Reply to image/video with ${ctx.prefix}sticker`, ctx.sessionName);
  try { const buf = await downloadMedia(mediaSource, mediaType); await conn.sendMessage(m.key.remoteJid, { sticker: buf }, { quoted: m }); }
  catch (e) { await plainReply(conn, m, `❌ Failed: ${e.message}`); }
});

registerCmd('toimg', async (conn, m, args, ctx) => {
  const quotedMsg = getQuotedMsg(m);
  const stickerObj = quotedMsg?.stickerMessage || m.message?.stickerMessage;
  if (!stickerObj) return fReply(conn, m, `Reply to sticker with ${ctx.prefix}toimg`, ctx.sessionName);
  try { const buf = await downloadMedia(stickerObj, 'sticker'); await conn.sendMessage(m.key.remoteJid, { image: buf, caption: '🖼️ Converted!' }, { quoted: m }); }
  catch (e) { await plainReply(conn, m, `❌ Failed: ${e.message}`); }
});

registerCmd('vv', async (conn, m, args, ctx) => {
  const quotedMsg = getQuotedMsg(m);
  if (!quotedMsg) return fReply(conn, m, `Reply to view-once with ${ctx.prefix}vv`, ctx.sessionName);
  const inner = quotedMsg?.viewOnceMessageV2?.message || quotedMsg?.viewOnceMessage?.message || quotedMsg;
  const t = getMediaType(inner);
  if (!t) return fReply(conn, m, '❌ No media found.', ctx.sessionName);
  try {
    const buf = await downloadMedia(t.inner, t.type);
    if (t.type==='image') await conn.sendMessage(m.key.remoteJid, { image: buf, caption: '👁️ Revealed' }, { quoted: m });
    else if (t.type==='video') await conn.sendMessage(m.key.remoteJid, { video: buf, caption: '👁️ Revealed' }, { quoted: m });
  } catch (e) { await plainReply(conn, m, `❌ Failed: ${e.message}`); }
});

registerCmd('copy', async (conn, m, args, ctx) => {
  const quotedMsg = getQuotedMsg(m);
  if (!quotedMsg) return fReply(conn, m, `Reply to a message with ${ctx.prefix}copy`, ctx.sessionName);
  await conn.sendMessage(m.key.remoteJid, quotedMsg, { quoted: m });
});

registerCmd('tts', async (conn, m, args, ctx) => {
  const text = args.join(' ');
  if (!text) return fReply(conn, m, `Usage: ${ctx.prefix}tts <text>`, ctx.sessionName);
  try {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=en&client=tw-ob`;
    await conn.sendMessage(m.key.remoteJid, { audio: { url }, mimetype: 'audio/mpeg', ptt: true }, { quoted: m });
  } catch (e) { await fReply(conn, m, `❌ TTS failed: ${e.message}`, ctx.sessionName); }
});

registerCmd('say', async (conn, m, args, ctx) => {
  const text = args.join(' ');
  if (!text) return fReply(conn, m, `Usage: ${ctx.prefix}say <text>`, ctx.sessionName);
  try {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=en&client=tw-ob`;
    await conn.sendMessage(m.key.remoteJid, { audio: { url }, mimetype: 'audio/mpeg', ptt: true }, { quoted: m });
  } catch (e) { await fReply(conn, m, `❌ Failed: ${e.message}`, ctx.sessionName); }
});
registerCmd('voicemenu', async (conn, m, args, ctx) => {
  await fReply(conn, m,
    `🎙️ *Voice Menu*\n\n` +
    `Available voices:\n` +
    `◈ Brian (Male UK)\n` +
    `◈ Amy (Female UK)\n` +
    `◈ Emma (Female UK)\n` +
    `◈ Joey (Male US)\n` +
    `◈ Justin (Male Young)\n` +
    `◈ Joanna (Female US)\n\n` +
    `Use: ${ctx.prefix}setvoice <name>`,
    ctx.sessionName
  );
});

registerCmd('setvoice', async (conn, m, args, ctx) => {
  if (!ctx.isOwner) return fReply(conn, m, '❌ Owner only.', ctx.sessionName);
  const voice = args[0];
  const voices = ['Brian','Amy','Emma','Joey','Justin','Joanna'];
  if (!voice || !voices.includes(voice)) return fReply(conn, m, `Available: ${voices.join(', ')}`, ctx.sessionName);
  setSessionSetting(ctx.sessionName, 'voice', voice);
  await fReply(conn, m, `✅ Voice set to: ${voice}`, ctx.sessionName);
});
registerCmd('google', async (conn, m, args, ctx) => {
  const query = args.join(' ');
  if (!query) return fReply(conn, m, `Usage: ${ctx.prefix}google <query>`, ctx.sessionName);
  await fReply(conn, m, '🔍 _Searching..._', ctx.sessionName);
  try {
    const data = await httpsGet(`https://ddg-api.herokuapp.com/search?query=${encodeURIComponent(query)}&limit=3`);
    const results = JSON.parse(data);
    if (!results.length) return fReply(conn, m, '❌ No results.', ctx.sessionName);
    let text = `🔍 *Google Results for:* ${query}\n\n`;
    results.forEach((r, i) => { text += `*${i+1}. ${r.title}*\n${r.snippet}\n🔗 ${r.link}\n\n`; });
    await fReply(conn, m, text, ctx.sessionName);
  } catch (e) {
    await fReply(conn, m, `🔍 Search: https://www.google.com/search?q=${encodeURIComponent(query)}`, ctx.sessionName);
  }
});

registerCmd('wiki', async (conn, m, args, ctx) => {
  const query = args.join(' ');
  if (!query) return fReply(conn, m, `Usage: ${ctx.prefix}wiki <topic>`, ctx.sessionName);
  await fReply(conn, m, '📖 _Searching Wikipedia..._', ctx.sessionName);
  try {
    const data = await httpsGet(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`);
    const parsed = JSON.parse(data);
    if (parsed.type === 'https://mediawiki.org/wiki/HyperSwitch/errors/not_found') return fReply(conn, m, '❌ Not found.', ctx.sessionName);
    await fReply(conn, m, `📖 *${parsed.title}*\n\n${parsed.extract?.substring(0, 1000) || 'No summary.'}\n\n🔗 ${parsed.content_urls?.desktop?.page || ''}`, ctx.sessionName);
  } catch (e) { await fReply(conn, m, `❌ Failed: ${e.message}`, ctx.sessionName); }
});

registerCmd('weather', async (conn, m, args, ctx) => {
  const city = args.join(' ');
  if (!city) return fReply(conn, m, `Usage: ${ctx.prefix}weather <city>`, ctx.sessionName);
  await fReply(conn, m, '🌤️ _Fetching weather..._', ctx.sessionName);
  try {
    const data = await httpsGet(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
    const parsed = JSON.parse(data);
    const current = parsed.current_condition[0];
    const area = parsed.nearest_area[0];
    await fReply(conn, m,
      `🌤️ *Weather — ${area.areaName[0].value}, ${area.country[0].value}*\n\n` +
      `🌡️ Temp: ${current.temp_C}°C / ${current.temp_F}°F\n` +
      `💧 Humidity: ${current.humidity}%\n` +
      `💨 Wind: ${current.windspeedKmph} km/h\n` +
      `☁️ Condition: ${current.weatherDesc[0].value}`,
      ctx.sessionName
    );
  } catch (e) { await fReply(conn, m, `❌ Failed: ${e.message}`, ctx.sessionName); }
});

registerCmd('news', async (conn, m, args, ctx) => {
  const source = (args[0] || '').toLowerCase();
  const sources = {
    bbc: 'https://apiskeith.top/news/bbc',
    tech: 'https://apiskeith.top/news/tech',
    football: 'https://apiskeith.top/football/news',
  };
  if (!source || !sources[source]) {
    return fReply(conn, m,
      `📰 *NOVA News*\n\nPick a source:\n` +
      `◈ ${ctx.prefix}news bbc\n` +
      `◈ ${ctx.prefix}news tech\n` +
      `◈ ${ctx.prefix}news football\n\n` +
      `_Powered by LUMINAR Inc 🇰🇪_`,
      ctx.sessionName
    );
  }
  await fReply(conn, m, `📰 _Fetching ${source} news..._`, ctx.sessionName);
  try {
    const data = await httpsGet(sources[source]);
    const parsed = JSON.parse(data);
    if (!parsed.status) throw new Error('No results');
    const articles = parsed.result?.topStories
      || parsed.result?.articles
      || parsed.result?.news
      || (Array.isArray(parsed.result) ? parsed.result : null);
    if (!articles || !articles.length) throw new Error('Empty results');
    const top5 = articles.slice(0, 5);
    let text = `📰 *${source.toUpperCase()} News*\n\n`;
    top5.forEach((a, i) => {
      const title = a.title || a.headline || 'No title';
      const time = a.metadata?.time || a.time || '';
      const link = a.url || a.link || '';
      text += `*${i + 1}.* ${title}\n`;
      if (time) text += `🕐 ${time}\n`;
      if (link) text += `🔗 ${link}\n`;
      text += '\n';
    });
    text += `_Powered by LUMINAR Inc 🇰🇪_`;
    await fReply(conn, m, text, ctx.sessionName);
  } catch (e) { await fReply(conn, m, `❌ Failed: ${e.message}`, ctx.sessionName); }
});

registerCmd('trailer', async (conn, m, args, ctx) => {
  const query = args.join(' ');
  if (!query) return fReply(conn, m, `Usage: ${ctx.prefix}trailer <movie name>`, ctx.sessionName);
  await fReply(conn, m, `🎬 _Fetching trailer for_ *${query}*...`, ctx.sessionName);
  try {
    const searchData = await httpsGet(`https://apiskeith.top/movie/trailer?q=${encodeURIComponent(query)}`);
    const parsed = JSON.parse(searchData);
    if (!parsed.status || !parsed.result) throw new Error('No result');
    const result = parsed.result;
    const trailerUrl = result.trailer || result.url || result.video || result.link;
    const title = result.title || query;
    const poster = result.poster || result.thumbnail || result.image || null;
    const desc = result.description || result.overview || '';
    const caption =
      `🎬 *${title}*\n\n` +
      (desc ? `📖 ${desc.slice(0, 200)}...\n\n` : '') +
      `_Powered by LUMINAR Inc 🇰🇪_`;
    if (trailerUrl) {
      await conn.sendMessage(m.key.remoteJid, { video: { url: trailerUrl }, caption }, { quoted: m });
    } else if (poster) {
      await conn.sendMessage(m.key.remoteJid, { image: { url: poster }, caption }, { quoted: m });
    } else {
      await fReply(conn, m, caption, ctx.sessionName);
    }
  } catch (e) { await fReply(conn, m, `❌ Failed: ${e.message}`, ctx.sessionName); }
});

registerCmd('xv', async (conn, m, args, ctx) => {
  if (!ctx.isOwner) return fReply(conn, m, '❌ Owner only. 😏', ctx.sessionName);
  const url = args[0];
  if (!url || !url.includes('xvideos.com')) return fReply(conn, m, `Usage: ${ctx.prefix}xv <xvideos url>`, ctx.sessionName);
  await fReply(conn, m, '📥 _Downloading..._', ctx.sessionName);
  try {
    const data = await httpsGet(`https://apiskeith.top/download/xvideos?url=${encodeURIComponent(url)}`);
    const parsed = JSON.parse(data);
    if (!parsed.status || !parsed.result) throw new Error('No result');
    const dlUrl = parsed.result.download_url;
    if (!dlUrl) throw new Error('No download URL');
    await conn.sendMessage(m.key.remoteJid, { video: { url: dlUrl }, caption: '📥 _NOVA-XMD 👀_' }, { quoted: m });
  } catch (e) { await fReply(conn, m, `❌ Failed: ${e.message}`, ctx.sessionName); }
});

registerCmd('whois', async (conn, m, args, ctx) => {
  const domain = args[0];
  if (!domain) return fReply(conn, m, `Usage: ${ctx.prefix}whois <domain>`, ctx.sessionName);
  try {
    const data = await httpsGet(`https://api.domainsdb.info/v1/domains/search?domain=${domain}&zone=com`);
    const parsed = JSON.parse(data);
    const d = parsed.domains?.[0];
    if (!d) return fReply(conn, m, '❌ No info found.', ctx.sessionName);
    await fReply(conn, m, `🌐 *WHOIS: ${domain}*\n\n📅 Created: ${d.create_date || 'N/A'}\n📅 Updated: ${d.update_date || 'N/A'}\n🌍 Country: ${d.country || 'N/A'}`, ctx.sessionName);
  } catch (e) { await fReply(conn, m, `❌ Failed: ${e.message}`, ctx.sessionName); }
});

registerCmd('ipinfo', async (conn, m, args, ctx) => {
  const ip = args[0] || '';
  try {
    const data = await httpsGet(`https://ipapi.co/${ip}/json/`);
    const parsed = JSON.parse(data);
    await fReply(conn, m,
      `🌐 *IP Info*\n\n` +
      `📍 IP: ${parsed.ip}\n` +
      `🌍 Country: ${parsed.country_name}\n` +
      `🏙️ City: ${parsed.city}\n` +
      `📡 ISP: ${parsed.org}\n` +
      `🕐 Timezone: ${parsed.timezone}`,
      ctx.sessionName
    );
  } catch (e) { await fReply(conn, m, `❌ Failed: ${e.message}`, ctx.sessionName); }
});
registerCmd('crypto', async (conn, m, args, ctx) => {
  const coin = (args[0] || 'bitcoin').toLowerCase();
  try {
    const data = await httpsGet(`https://api.coingecko.com/api/v3/simple/price?ids=${coin}&vs_currencies=usd,kes&include_24hr_change=true`);
    const parsed = JSON.parse(data);
    const c = parsed[coin];
    if (!c) return fReply(conn, m, `❌ Coin not found: ${coin}`, ctx.sessionName);
    await fReply(conn, m,
      `💰 *${coin.toUpperCase()}*\n\n` +
      `💵 USD: $${c.usd?.toLocaleString()}\n` +
      `🇰🇪 KES: KSh ${c.kes?.toLocaleString()}\n` +
      `📈 24h: ${c.usd_24h_change?.toFixed(2)}%`,
      ctx.sessionName
    );
  } catch (e) { await fReply(conn, m, `❌ Failed: ${e.message}`, ctx.sessionName); }
});

registerCmd('currency', async (conn, m, args, ctx) => {
  if (args.length < 3) return fReply(conn, m, `Usage: ${ctx.prefix}currency 100 USD KES`, ctx.sessionName);
  const [amount, from, to] = args;
  try {
    const data = await httpsGet(`https://api.exchangerate-api.com/v4/latest/${from.toUpperCase()}`);
    const parsed = JSON.parse(data);
    const rate = parsed.rates[to.toUpperCase()];
    if (!rate) return fReply(conn, m, '❌ Invalid currency.', ctx.sessionName);
    const result = (parseFloat(amount) * rate).toFixed(2);
    await fReply(conn, m, `💱 *Currency Convert*\n\n${amount} ${from.toUpperCase()} = *${result} ${to.toUpperCase()}*`, ctx.sessionName);
  } catch (e) { await fReply(conn, m, `❌ Failed: ${e.message}`, ctx.sessionName); }
});

registerCmd('calculate', async (conn, m, args, ctx) => {
  const expr = args.join(' ');
  if (!expr) return fReply(conn, m, `Usage: ${ctx.prefix}calculate 2+2`, ctx.sessionName);
  try {
    const safe = expr.replace(/[^0-9+\-*/().%\s]/g, '');
    const result = Function(`'use strict'; return (${safe})`)();
    await fReply(conn, m, `🧮 *Calculate*\n\n${expr} = *${result}*`, ctx.sessionName);
  } catch { await fReply(conn, m, '❌ Invalid expression.', ctx.sessionName); }
});

registerCmd('upload', async (conn, m, args, ctx) => {
  const quotedMsg = getQuotedMsg(m);
  const imgObj = quotedMsg?.imageMessage || m.message?.imageMessage;
  if (!imgObj) return fReply(conn, m, `Reply to an image with ${ctx.prefix}upload`, ctx.sessionName);
  await fReply(conn, m, '☁️ _Uploading..._', ctx.sessionName);
  try {
    const buf = await downloadMedia(imgObj, 'image');
    const boundary = '----FormBoundary' + Math.random().toString(36);
    const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="upload.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`;
    const footer = `\r\n--${boundary}--\r\n`;
    const body = Buffer.concat([Buffer.from(header), buf, Buffer.from(footer)]);
    const response = await new Promise((resolve, reject) => {
      const options = {
        hostname: '0x0.st',
        path: '/',
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length }
      };
      const req = https.request(options, res => { let d = ''; res.on('data', chunk => d += chunk); res.on('end', () => resolve(d)); });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
    if (response.startsWith('https')) {
      await fReply(conn, m, `☁️ *Uploaded!*\n\n🔗 ${response.trim()}`, ctx.sessionName);
    } else {
      await fReply(conn, m, '❌ Upload failed.', ctx.sessionName);
    }
  } catch (e) { await fReply(conn, m, `❌ Failed: ${e.message}`, ctx.sessionName); }
});

registerCmd('pastebin', async (conn, m, args, ctx) => {
  const text = args.join(' ') || getMsgText(getQuotedMsg(m) ? { message: getQuotedMsg(m) } : m);
  if (!text) return fReply(conn, m, `Usage: ${ctx.prefix}pastebin <text> or reply to a message`, ctx.sessionName);
  try {
    const url = `https://hastebin.com/documents`;
    const response = await new Promise((resolve, reject) => {
      const options = { hostname: 'hastebin.com', path: '/documents', method: 'POST', headers: { 'Content-Type': 'text/plain' } };
      const req = https.request(options, res => { let d = ''; res.on('data', chunk => d += chunk); res.on('end', () => resolve(d)); });
      req.on('error', reject);
      req.write(text);
      req.end();
    });
    const parsed = JSON.parse(response);
    await fReply(conn, m, `📋 *Pastebin Created*\n\n🔗 https://hastebin.com/${parsed.key}`, ctx.sessionName);
  } catch (e) { await fReply(conn, m, `❌ Failed: ${e.message}`, ctx.sessionName); }
});

registerCmd('github', async (conn, m, args, ctx) => {
  const query = args.join(' ');
  if (!query) return fReply(conn, m, `Usage: ${ctx.prefix}github <repo or user>`, ctx.sessionName);
  try {
    const data = await httpsGet(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=3`);
    const parsed = JSON.parse(data);
    if (!parsed.items?.length) return fReply(conn, m, '❌ No results.', ctx.sessionName);
    let text = `💻 *GitHub Results*\n\n`;
    parsed.items.forEach((r, i) => { text += `*${i+1}. ${r.full_name}*\n⭐ ${r.stargazers_count} | 🍴 ${r.forks_count}\n${r.description || 'No description'}\n🔗 ${r.html_url}\n\n`; });
    await fReply(conn, m, text, ctx.sessionName);
  } catch (e) { await fReply(conn, m, `❌ Failed: ${e.message}`, ctx.sessionName); }
});

registerCmd('npm', async (conn, m, args, ctx) => {
  const pkg = args[0];
  if (!pkg) return fReply(conn, m, `Usage: ${ctx.prefix}npm <package>`, ctx.sessionName);
  try {
    const data = await httpsGet(`https://registry.npmjs.org/${pkg}/latest`);
    const parsed = JSON.parse(data);
    await fReply(conn, m,
      `📦 *NPM: ${parsed.name}*\n\n` +
      `📌 Version: ${parsed.version}\n` +
      `📝 ${parsed.description || 'No description'}\n` +
      `👤 Author: ${parsed.author?.name || 'Unknown'}\n` +
      `🔗 npmjs.com/package/${pkg}`,
      ctx.sessionName
    );
  } catch (e) { await fReply(conn, m, `❌ Package not found: ${pkg}`, ctx.sessionName); }
});

registerCmd('base64', async (conn, m, args, ctx) => {
  const mode = args[0];
  const text = args.slice(1).join(' ');
  if (!mode || !text) return fReply(conn, m, `Usage: ${ctx.prefix}base64 encode/decode <text>`, ctx.sessionName);
  if (mode === 'encode') await fReply(conn, m, `🔐 *Encoded*\n\n${Buffer.from(text).toString('base64')}`, ctx.sessionName);
  else if (mode === 'decode') { try { await fReply(conn, m, `🔓 *Decoded*\n\n${Buffer.from(text, 'base64').toString('utf-8')}`, ctx.sessionName); } catch { await fReply(conn, m, '❌ Invalid base64.', ctx.sessionName); } }
  else await fReply(conn, m, `Usage: ${ctx.prefix}base64 encode/decode <text>`, ctx.sessionName);
});

registerCmd('hash', async (conn, m, args, ctx) => {
  const text = args.join(' ');
  if (!text) return fReply(conn, m, `Usage: ${ctx.prefix}hash <text>`, ctx.sessionName);
  const crypto = require('crypto');
  const md5 = crypto.createHash('md5').update(text).digest('hex');
  const sha256 = crypto.createHash('sha256').update(text).digest('hex');
  await fReply(conn, m, `#️⃣ *Hash*\n\n🔑 MD5:\n${md5}\n\n🔑 SHA256:\n${sha256}`, ctx.sessionName);
});

registerCmd('genpass', async (conn, m, args, ctx) => {
  const len = parseInt(args[0]) || 16;
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let pass = '';
  for (let i = 0; i < len; i++) pass += chars[Math.floor(Math.random() * chars.length)];
  await fReply(conn, m, `🔐 *Generated Password*\n\n\`${pass}\`\n\n_Length: ${len} chars_`, ctx.sessionName);
});

registerCmd('uuid', async (conn, m, args, ctx) => {
  const uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
  await fReply(conn, m, `🆔 *UUID Generated*\n\n\`${uuid}\``, ctx.sessionName);
});

registerCmd('shorturl', async (conn, m, args, ctx) => {
  const url = args[0];
  if (!url) return fReply(conn, m, `Usage: ${ctx.prefix}shorturl <url>`, ctx.sessionName);
  try {
    const data = await httpsGet(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`);
    await fReply(conn, m, `🔗 *Short URL*\n\n${data}`, ctx.sessionName);
  } catch (e) { await fReply(conn, m, `❌ Failed: ${e.message}`, ctx.sessionName); }
});

registerCmd('encode', async (conn, m, args, ctx) => {
  const text = args.join(' ');
  if (!text) return fReply(conn, m, `Usage: ${ctx.prefix}encode <text>`, ctx.sessionName);
  const morse = { a:'.-',b:'-...',c:'-.-.',d:'-..',e:'.',f:'..-.',g:'--.',h:'....',i:'..',j:'.---',k:'-.-',l:'.-..',m:'--',n:'-.',o:'---',p:'.--.',q:'--.-',r:'.-.',s:'...',t:'-',u:'..-',v:'...-',w:'.--',x:'-..-',y:'-.--',z:'--..',' ':'/' };
  const encoded = text.toLowerCase().split('').map(c => morse[c] || c).join(' ');
  await fReply(conn, m, `📡 *Morse Code*\n\n${encoded}`, ctx.sessionName);
});

registerCmd('decode', async (conn, m, args, ctx) => {
  const text = args.join(' ');
  if (!text) return fReply(conn, m, `Usage: ${ctx.prefix}decode <morse code>`, ctx.sessionName);
  const morse = { '.-':'a','-...':'b','-.-.':'c','-..':'d','.':'e','..-.':'f','--.':'g','....':'h','..':'i','.---':'j','-.-':'k','.-..':'l','--':'m','-.':'n','---':'o','.--.':'p','--.-':'q','.-.':'r','...':'s','-':'t','..-':'u','...-':'v','.--':'w','-..-':'x','-.--':'y','--..':'z','/':' ' };
  const decoded = text.split(' ').map(c => morse[c] || c).join('');
  await fReply(conn, m, `📡 *Decoded*\n\n${decoded}`, ctx.sessionName);
});
registerCmd('getpp', async (conn, m, args, ctx) => {
  const target = resolveTarget(m, args);
  if (!target) return fReply(conn, m, `Reply to, @mention or provide number.\nUsage: ${ctx.prefix}getpp`, ctx.sessionName);
  const jid = target.includes('@') ? target : `${target.replace(/[^0-9]/g,'')}@s.whatsapp.net`;
  try {
    const ppUrl = await conn.profilePictureUrl(jid, 'image');
    await conn.sendMessage(m.key.remoteJid, { image: { url: ppUrl }, caption: `👤 Profile picture of @${normalizeNumber(jid)}`, mentions: [jid] }, { quoted: m });
  } catch { await fReply(conn, m, '❌ No profile picture found.', ctx.sessionName); }
});

registerCmd('bio', async (conn, m, args, ctx) => {
  const target = resolveTarget(m, args);
  if (!target) return fReply(conn, m, `Usage: ${ctx.prefix}bio`, ctx.sessionName);
  const jid = target.includes('@') ? target : `${target.replace(/[^0-9]/g,'')}@s.whatsapp.net`;
  try {
    const status = await conn.fetchStatus(jid);
    await fReply(conn, m, `📝 *Bio of @${normalizeNumber(jid)}*\n\n${status?.status || 'No bio set.'}`, ctx.sessionName);
  } catch { await fReply(conn, m, '❌ Could not fetch bio.', ctx.sessionName); }
});

registerCmd('id', async (conn, m, args, ctx) => {
  const remoteJid = m.key.remoteJid;
  const senderJid = m.key.participant || remoteJid;
  await fReply(conn, m,
    `🆔 *ID Info*\n\n` +
    `👤 Your JID: ${senderJid}\n` +
    `📱 Number: ${normalizeNumber(senderJid)}\n` +
    `💬 Chat: ${remoteJid}\n` +
    `🔑 Message ID: ${m.key.id}`,
    ctx.sessionName
  );
});

registerCmd('rps', async (conn, m, args, ctx) => {
  const choice = (args[0] || '').toLowerCase();
  if (!['rock','paper','scissors'].includes(choice)) return fReply(conn, m, `Usage: ${ctx.prefix}rps rock/paper/scissors`, ctx.sessionName);
  const options = ['rock','paper','scissors'];
  const bot = options[Math.floor(Math.random()*3)];
  const wins = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
  const emoji = { rock: '🪨', paper: '📄', scissors: '✂️' };
  let result = '';
  if (choice === bot) result = '🤝 Draw!';
  else if (wins[choice] === bot) result = '🎉 You win!';
  else result = '😈 Bot wins!';
  await fReply(conn, m, `🎮 *Rock Paper Scissors*\n\nYou: ${emoji[choice]} ${choice}\nBot: ${emoji[bot]} ${bot}\n\n${result}`, ctx.sessionName);
});

registerCmd('guess', async (conn, m, args, ctx) => {
  const remoteJid = m.key.remoteJid;
  if (!gameSessions.has(remoteJid)) {
    const number = Math.floor(Math.random()*100)+1;
    gameSessions.set(remoteJid, { number, attempts: 0 });
    return fReply(conn, m, `🎮 *Number Guessing Game*\n\nI picked a number between 1-100!\nUse ${ctx.prefix}guess <number> to guess!`, ctx.sessionName);
  }
  const game = gameSessions.get(remoteJid);
  const guess = parseInt(args[0]);
  if (isNaN(guess)) return fReply(conn, m, `Enter a number! Usage: ${ctx.prefix}guess <number>`, ctx.sessionName);
  game.attempts++;
  if (guess === game.number) {
    gameSessions.delete(remoteJid);
    return fReply(conn, m, `🎉 *Correct!* The number was ${game.number}!\nYou got it in ${game.attempts} attempts!`, ctx.sessionName);
  }
  await fReply(conn, m, guess < game.number ? `📈 Too low! Try higher. (Attempt ${game.attempts})` : `📉 Too high! Try lower. (Attempt ${game.attempts})`, ctx.sessionName);
});

registerCmd('trivia', async (conn, m, args, ctx) => {
  try {
    const data = await httpsGet('https://opentdb.com/api.php?amount=1&type=multiple');
    const parsed = JSON.parse(data);
    const q = parsed.results[0];
    const answers = [...q.incorrect_answers, q.correct_answer].sort(() => Math.random()-0.5);
    const letters = ['A','B','C','D'];
    let text = `🧠 *Trivia*\n\n*${q.question.replace(/&quot;/g,'"').replace(/&#039;/g,"'")}*\n\n`;
    answers.forEach((a, i) => { text += `${letters[i]}. ${a.replace(/&quot;/g,'"').replace(/&#039;/g,"'")}\n`; });
    text += `\n_Category: ${q.category}_`;
    await fReply(conn, m, text, ctx.sessionName);
  } catch (e) { await fReply(conn, m, `❌ Failed: ${e.message}`, ctx.sessionName); }
});
registerCmd('promote', async (conn, m, args, ctx) => {
  if (!ctx.isOwner&&!ctx.isAdmin) return fReply(conn, m, '❌ Admin only.', ctx.sessionName);
  if (!m.key.remoteJid.endsWith('@g.us')) return fReply(conn, m, '❌ Groups only.', ctx.sessionName);
  const target = resolveTarget(m, args);
  if (!target) return fReply(conn, m, `Usage: ${ctx.prefix}promote`, ctx.sessionName);
  const jid = target.includes('@') ? target : `${target.replace(/[^0-9]/g,'')}@s.whatsapp.net`;
  await conn.groupParticipantsUpdate(m.key.remoteJid, [jid], 'promote');
  await conn.sendMessage(m.key.remoteJid, { text: `👑 @${normalizeNumber(jid)} promoted!`, mentions: [jid] }, { quoted: m });
});

registerCmd('demote', async (conn, m, args, ctx) => {
  if (!ctx.isOwner&&!ctx.isAdmin) return fReply(conn, m, '❌ Admin only.', ctx.sessionName);
  if (!m.key.remoteJid.endsWith('@g.us')) return fReply(conn, m, '❌ Groups only.', ctx.sessionName);
  const target = resolveTarget(m, args);
  if (!target) return fReply(conn, m, `Usage: ${ctx.prefix}demote`, ctx.sessionName);
  const jid = target.includes('@') ? target : `${target.replace(/[^0-9]/g,'')}@s.whatsapp.net`;
  await conn.groupParticipantsUpdate(m.key.remoteJid, [jid], 'demote');
  await conn.sendMessage(m.key.remoteJid, { text: `⬇️ @${normalizeNumber(jid)} demoted.`, mentions: [jid] }, { quoted: m });
});

registerCmd('kick', async (conn, m, args, ctx) => {
  if (!ctx.isOwner&&!ctx.isAdmin) return fReply(conn, m, '❌ Admin only.', ctx.sessionName);
  if (!m.key.remoteJid.endsWith('@g.us')) return fReply(conn, m, '❌ Groups only.', ctx.sessionName);
  const target = resolveTarget(m, args);
  if (!target) return fReply(conn, m, `Usage: ${ctx.prefix}kick`, ctx.sessionName);
  const jid = target.includes('@') ? target : `${target.replace(/[^0-9]/g,'')}@s.whatsapp.net`;
  await conn.groupParticipantsUpdate(m.key.remoteJid, [jid], 'remove');
  await conn.sendMessage(m.key.remoteJid, { text: `🦵 @${normalizeNumber(jid)} kicked!`, mentions: [jid] }, { quoted: m });
});

registerCmd('add', async (conn, m, args, ctx) => {
  if (!ctx.isOwner&&!ctx.isAdmin) return fReply(conn, m, '❌ Admin only.', ctx.sessionName);
  if (!m.key.remoteJid.endsWith('@g.us')) return fReply(conn, m, '❌ Groups only.', ctx.sessionName);
  let t = (args[0]||'').replace(/[^0-9]/g,'');
  if (!t) return fReply(conn, m, `Usage: ${ctx.prefix}add <number>`, ctx.sessionName);
  await conn.groupParticipantsUpdate(m.key.remoteJid, [`${t}@s.whatsapp.net`], 'add');
  await fReply(conn, m, `✅ ${t} added!`, ctx.sessionName);
});

registerCmd('tagall', async (conn, m, args, ctx) => {
  if (!ctx.isOwner&&!ctx.isAdmin) return fReply(conn, m, '❌ Admin only.', ctx.sessionName);
  if (!m.key.remoteJid.endsWith('@g.us')) return fReply(conn, m, '❌ Groups only.', ctx.sessionName);
  const meta = await conn.groupMetadata(m.key.remoteJid);
  const members = meta.participants.map(p => p.id);
  const msg = args.join(' ') || '📢 Attention!';
  await conn.sendMessage(m.key.remoteJid, { text: msg+'\n\n'+members.map(id=>`@${normalizeNumber(id)}`).join(' '), mentions: members }, { quoted: m });
});

registerCmd('groupinfo', async (conn, m, args, ctx) => {
  if (!m.key.remoteJid.endsWith('@g.us')) return fReply(conn, m, '❌ Groups only.', ctx.sessionName);
  const meta = await conn.groupMetadata(m.key.remoteJid);
  const admins = meta.participants.filter(p=>p.admin).map(p=>normalizeNumber(p.id)).join(', ');
  await fReply(conn, m,
    `📋 *Group Info*\n\n` +
    `🏷️ Name: ${meta.subject}\n` +
    `👥 Members: ${meta.participants.length}\n` +
    `👮 Admins: ${admins||'None'}\n` +
    `📝 Desc: ${meta.desc||'None'}`,
    ctx.sessionName
  );
});

registerCmd('mute', async (conn, m, args, ctx) => {
  if (!ctx.isOwner&&!ctx.isAdmin) return fReply(conn, m, '❌ Admin only.', ctx.sessionName);
  if (!m.key.remoteJid.endsWith('@g.us')) return fReply(conn, m, '❌ Groups only.', ctx.sessionName);
  await conn.groupSettingUpdate(m.key.remoteJid, 'announcement');
  await fReply(conn, m, '🔇 Muted.', ctx.sessionName);
});

registerCmd('unmute', async (conn, m, args, ctx) => {
  if (!ctx.isOwner&&!ctx.isAdmin) return fReply(conn, m, '❌ Admin only.', ctx.sessionName);
  if (!m.key.remoteJid.endsWith('@g.us')) return fReply(conn, m, '❌ Groups only.', ctx.sessionName);
  await conn.groupSettingUpdate(m.key.remoteJid, 'not_announcement');
  await fReply(conn, m, '🔊 Unmuted.', ctx.sessionName);
});

registerCmd('group', async (conn, m, args, ctx) => {
  if (!ctx.isOwner&&!ctx.isAdmin) return fReply(conn, m, '❌ Admin only.', ctx.sessionName);
  if (!m.key.remoteJid.endsWith('@g.us')) return fReply(conn, m, '❌ Groups only.', ctx.sessionName);
  const o = (args[0]||'').toLowerCase();
  if (o==='open') { await conn.groupSettingUpdate(m.key.remoteJid,'not_announcement'); await fReply(conn,m,'✅ Opened.',ctx.sessionName); }
  else if (o==='close') { await conn.groupSettingUpdate(m.key.remoteJid,'announcement'); await fReply(conn,m,'✅ Closed.',ctx.sessionName); }
  else await fReply(conn, m, `Usage: ${ctx.prefix}group open/close`, ctx.sessionName);
});

registerCmd('antilink', async (conn, m, args, ctx) => {
  if (!ctx.isOwner&&!ctx.isAdmin) return fReply(conn, m, '❌ Admin only.', ctx.sessionName);
  const o = (args[0]||'').toLowerCase();
  if (!['off','del','warn','kick'].includes(o)) return fReply(conn, m, `Usage: ${ctx.prefix}antilink off/del/warn/kick\n\n_warn: 4 strikes then auto-kick on 5th_`, ctx.sessionName);
  setSessionSetting(ctx.sessionName, 'antilink', o);
  const desc = o==='warn' ? '⚠️ Users get 4 warnings then auto-kicked on 5th.' : o==='kick' ? '👞 Instant kick on link.' : o==='del' ? '🗑️ Link silently deleted.' : '🔓 Disabled.';
  await fReply(conn, m, `✅ Antilink: *${o.toUpperCase()}*\n${desc}`, ctx.sessionName);
});

registerCmd('antidelete', async (conn, m, args, ctx) => {
  if (!ctx.isOwner&&!ctx.isAdmin) return fReply(conn, m, '❌ Admin only.', ctx.sessionName);
  const next = !getSessionSetting(ctx.sessionName, 'antidelete', false);
  setSessionSetting(ctx.sessionName, 'antidelete', next);
  await fReply(conn, m, `✅ Antidelete: ${next?'ON':'OFF'}`, ctx.sessionName);
});

registerCmd('setbadword', async (conn, m, args, ctx) => {
  if (!ctx.isOwner) return fReply(conn, m, '❌ Owner only.', ctx.sessionName);
  if (!args.length) return fReply(conn, m, `Usage: ${ctx.prefix}setbadword word1 word2 word3`, ctx.sessionName);
  const existing = getBadWords();
  const added = [];
  for (const w of args) {
    const word = w.toLowerCase().trim();
    if (word && !existing.includes(word)) { existing.push(word); added.push(word); }
  }
  saveBadWords(existing);
  await fReply(conn, m, `✅ Added ${added.length} bad word(s):\n${added.map(w=>`◈ ${w}`).join('\n')}\n\nTotal: ${existing.length} word(s)`, ctx.sessionName);
});

registerCmd('deletebadword', async (conn, m, args, ctx) => {
  if (!ctx.isOwner) return fReply(conn, m, '❌ Owner only.', ctx.sessionName);
  if (!args.length) return fReply(conn, m, `Usage: ${ctx.prefix}deletebadword word1 word2`, ctx.sessionName);
  let existing = getBadWords();
  const removed = [];
  for (const w of args) {
    const word = w.toLowerCase().trim();
    if (existing.includes(word)) { existing = existing.filter(x => x !== word); removed.push(word); }
  }
  saveBadWords(existing);
  await fReply(conn, m, `✅ Removed ${removed.length} word(s):\n${removed.map(w=>`◈ ${w}`).join('\n')}\n\nRemaining: ${existing.length} word(s)`, ctx.sessionName);
});
const bannedUsers = new Set();

registerCmd('setprefix', async (conn, m, args, ctx) => {
  if (!ctx.isOwner) return fReply(conn, m, '❌ Owner only.', ctx.sessionName);
  if (!args[0]) return fReply(conn, m, `Usage: ${ctx.prefix}setprefix <symbol>`, ctx.sessionName);
  setSessionSetting(ctx.sessionName, 'prefix', args[0].trim());
  await fReply(conn, m, `✅ Prefix: ${args[0].trim()}`, ctx.sessionName);
});

registerCmd('setbotname', async (conn, m, args, ctx) => {
  if (!ctx.isOwner) return fReply(conn, m, '❌ Owner only.', ctx.sessionName);
  const name = args.join(' ').trim();
  if (!name) return fReply(conn, m, `Usage: ${ctx.prefix}setbotname <name>`, ctx.sessionName);
  setSessionSetting(ctx.sessionName, 'botName', name);
  await fReply(conn, m, `✅ Bot name: ${name}`, ctx.sessionName);
});

registerCmd('setmenuimg', async (conn, m, args, ctx) => {
  if (!ctx.isOwner) return fReply(conn, m, '❌ Owner only.', ctx.sessionName);
  if (!args[0]) return fReply(conn, m, `Usage: ${ctx.prefix}setmenuimg <url>`, ctx.sessionName);
  setSessionSetting(ctx.sessionName, 'menuImage', args[0]);
  await fReply(conn, m, `✅ Menu image updated.`, ctx.sessionName);
});

registerCmd('setfonts', async (conn, m, args, ctx) => {
  if (!ctx.isOwner) return fReply(conn, m, '❌ Owner only.', ctx.sessionName);
  const num = parseInt(args[0]);
  if (!num || num < 1 || num > FONT_COUNT) return plainReply(conn, m, `Usage: ${ctx.prefix}setfonts <1-${FONT_COUNT}>\nUse ${ctx.prefix}fonts to preview`);
  setSessionSetting(ctx.sessionName, 'font', num);
  const s = num > 1 ? applyFont('NOVA-XMD Active!', num) : 'NOVA-XMD Active! (Normal)';
  await conn.sendMessage(m.key.remoteJid, { text: `✅ ${s}` }, { quoted: m });
});

registerCmd('fonts', async (conn, m, args, ctx) => {
  const samples = ['1. Normal → Hello World','2. Script → 𝒜𝓁𝓁 𝒢𝓇𝑒𝒶𝓉','3. Italic → 𝐻𝑒𝑙𝑙𝑜','4. Bold Italic → 𝑯𝒆𝒍𝒍𝒐','5. Bold → 𝐇𝐞𝐥𝐥𝐨','6. Sans → 𝖧𝖾𝗅𝗅𝗈','7. Sans Italic → 𝘏𝘦𝘭𝘭𝘰','8. Sans Bold → 𝙃𝙚𝙡𝙡𝙤','9. Bold Sans → 𝗛𝗲𝗹𝗹𝗼','10. Fraktur → 𝔥𝔢𝔩𝔩𝔬','11. Bold Fraktur → 𝖍𝖊𝖑𝖑𝖔','12. Monospace → 𝚑𝚎𝚕𝚕𝚘','13. Double Struck → 𝕙𝕖𝕝𝕝𝕠','14. Mono Alt → 𝚑𝚎𝚕𝚕𝚘'];
  await conn.sendMessage(m.key.remoteJid, { text: `🔤 *Fonts*\nUse: ${ctx.prefix}setfonts <number>\n\n${samples.join('\n')}` }, { quoted: m });
});

registerCmd('addprem', async (conn, m, args, ctx) => {
  if (!ctx.isOwner) return fReply(conn, m, '❌ Owner only.', ctx.sessionName);
  let t = resolveTarget(m, args);
  if (!t) return fReply(conn, m, `Usage: ${ctx.prefix}addprem <number>`, ctx.sessionName);
  t = t.replace(/[^0-9]/g, '');
  await fReply(conn, m, addPremium(t) ? `✅ ${t} premium added.` : `⚠️ Already premium.`, ctx.sessionName);
});

registerCmd('delprem', async (conn, m, args, ctx) => {
  if (!ctx.isOwner) return fReply(conn, m, '❌ Owner only.', ctx.sessionName);
  let t = resolveTarget(m, args);
  if (!t) return fReply(conn, m, `Usage: ${ctx.prefix}delprem <number>`, ctx.sessionName);
  t = t.replace(/[^0-9]/g, '');
  await fReply(conn, m, delPremium(t) ? `✅ ${t} removed.` : `⚠️ Not in list.`, ctx.sessionName);
});

registerCmd('public', async (conn, m, args, ctx) => {
  if (!ctx.isOwner) return fReply(conn, m, '❌ Owner only.', ctx.sessionName);
  setSessionSetting(ctx.sessionName, 'mode', 'public');
  await fReply(conn, m, '✅ Public mode.', ctx.sessionName);
});

registerCmd('self', async (conn, m, args, ctx) => {
  if (!ctx.isOwner) return fReply(conn, m, '❌ Owner only.', ctx.sessionName);
  setSessionSetting(ctx.sessionName, 'mode', 'self');
  await fReply(conn, m, '✅ Self mode.', ctx.sessionName);
});

registerCmd('ban', async (conn, m, args, ctx) => {
  if (!ctx.isOwner) return fReply(conn, m, '❌ Owner only.', ctx.sessionName);
  let t = resolveTarget(m, args);
  if (!t) return fReply(conn, m, `Usage: ${ctx.prefix}ban <number>`, ctx.sessionName);
  t = t.replace(/[^0-9]/g, '');
  bannedUsers.add(t);
  await fReply(conn, m, `✅ ${t} banned.`, ctx.sessionName);
});

registerCmd('unban', async (conn, m, args, ctx) => {
  if (!ctx.isOwner) return fReply(conn, m, '❌ Owner only.', ctx.sessionName);
  let t = resolveTarget(m, args);
  if (!t) return fReply(conn, m, `Usage: ${ctx.prefix}unban <number>`, ctx.sessionName);
  t = t.replace(/[^0-9]/g, '');
  bannedUsers.delete(t);
  await fReply(conn, m, `✅ ${t} unbanned.`, ctx.sessionName);
});

registerCmd('autoviewstatus', async (conn, m, args, ctx) => {
  if (!ctx.isOwner) return fReply(conn, m, '❌ Owner only.', ctx.sessionName);
  const next = !getSessionSetting(ctx.sessionName, 'autoViewStatus', false);
  setSessionSetting(ctx.sessionName, 'autoViewStatus', next);
  await fReply(conn, m, `✅ Auto view status: ${next ? 'ON' : 'OFF'}`, ctx.sessionName);
});

registerCmd('autolikestatus', async (conn, m, args, ctx) => {
  if (!ctx.isOwner) return fReply(conn, m, '❌ Owner only.', ctx.sessionName);
  const next = !getSessionSetting(ctx.sessionName, 'autoLikeStatus', false);
  setSessionSetting(ctx.sessionName, 'autoLikeStatus', next);
  await fReply(conn, m, `✅ Auto like status: ${next ? 'ON' : 'OFF'}`, ctx.sessionName);
});

registerCmd('block', async (conn, m, args, ctx) => {
  const { isOwner, sessionName, botNumber } = ctx;
  if (!isOwner) return fReply(conn, m, '❌ Owner only.', sessionName);
  const remoteJid = m.key.remoteJid;
  const isGroup = remoteJid.endsWith('@g.us');
  let targetJid;
  if (args[0]) {
    const num = args[0].replace(/[^0-9]/g, '');
    if (!num) return fReply(conn, m, '❌ Invalid number.', sessionName);
    targetJid = `${num}@s.whatsapp.net`;
  } else if (!isGroup) {
    if (m.key.fromMe) return fReply(conn, m, '😂 Silly, you can\'t lock yourself out!', sessionName);
    targetJid = remoteJid;
  } else {
    return fReply(conn, m, `Usage: ${ctx.prefix}block <number>`, sessionName);
  }
  const cleanedTarget = targetJid.split('@')[0];
  if (cleanedTarget === botNumber)
    return fReply(conn, m, '😂 Silly, you can\'t lock yourself out!', sessionName);
  try {
    await conn.updateBlockStatus(`${cleanedTarget}@s.whatsapp.net`, 'block');
    await fReply(conn, m, `✅ Blocked *${cleanedTarget}*`, sessionName);
  } catch (e) { await fReply(conn, m, `❌ Failed: ${e.message}`, sessionName); }
});

registerCmd('deleteaway', async (conn, m, args, ctx) => {
  if (!ctx.isOwner) return fReply(conn, m, '❌ Owner only.', ctx.sessionName);
  saveAwaySettings({ enabled: false, message: '' });
  await fReply(conn, m, '✅ Away message removed.', ctx.sessionName);
});

registerCmd('setmsgcode', async (conn, m, args, ctx) => {
  if (!ctx.isOwner) return fReply(conn, m, '❌ Owner only.', ctx.sessionName);
  if (!args.length) return fReply(conn, m, `Usage: ${ctx.prefix}setmsgcode 254 234 255`, ctx.sessionName);
  const codes = args.map(c => c.replace(/[^0-9]/g, '')).filter(Boolean);
  saveMsgCodes({ enabled: true, codes });
  await fReply(conn, m, `✅ Message filter ON\nAllowed codes:\n${codes.map(c=>`◈ +${c}`).join('\n')}\n\nAnyone outside these codes gets auto-blocked.`, ctx.sessionName);
});

registerCmd('deletemsgcode', async (conn, m, args, ctx) => {
  if (!ctx.isOwner) return fReply(conn, m, '❌ Owner only.', ctx.sessionName);
  saveMsgCodes({ enabled: false, codes: [] });
  await fReply(conn, m, '✅ Message filter OFF. Everyone can message you now.', ctx.sessionName);
});

registerCmd('setdata', async (conn, m, args, ctx) => {
  if (!ctx.isOwner) return fReply(conn, m, '❌ Owner only.', ctx.sessionName);
  const provider = args[0]?.toLowerCase();
  if (!provider) return fReply(conn, m, `Usage: ${ctx.prefix}setdata <provider>\nExample: ${ctx.prefix}setdata saf`, ctx.sessionName);
  if (!global._dataPending) global._dataPending = {};
  global._dataPending[ctx.sessionName] = { provider, waiting: true };
  await fReply(conn, m, `📦 *Setting up .${provider}*\n\nNow send your packages & payment info as your next message.\n\n_No need to reply, just type it normally_ ✅`, ctx.sessionName);
});

registerCmd('deletedata', async (conn, m, args, ctx) => {
  if (!ctx.isOwner) return fReply(conn, m, '❌ Owner only.', ctx.sessionName);
  const provider = args[0]?.toLowerCase();
  if (!provider) return fReply(conn, m, `Usage: ${ctx.prefix}deletedata <provider>`, ctx.sessionName);
  const packs = getDataPacks();
  if (!packs[provider]) return fReply(conn, m, `❌ No data pack found for: ${provider}`, ctx.sessionName);
  delete packs[provider];
  delete COMMANDS[provider];
  saveDataPacks(packs);
  await fReply(conn, m, `✅ Deleted .${provider} data pack.`, ctx.sessionName);
});

registerCmd('datamenu', async (conn, m, args, ctx) => {
  const packs = getDataPacks();
  const keys = Object.keys(packs);
  if (!keys.length) return fReply(conn, m, `📦 No data packs set yet.\nOwner can add with ${ctx.prefix}setdata <provider>`, ctx.sessionName);
  const list = keys.map(k => `◈ ${ctx.prefix}${k}`).join('\n');
  await fReply(conn, m, `📦 *Available Data Packages*\n\n${list}\n\n_Type any command to get packages & payment info_`, ctx.sessionName);
});

registerCmd('listonline', async (conn, m, args, ctx) => {
  const { sessionName } = ctx;
  const remoteJid = m.key.remoteJid;
  const isGroup = remoteJid.endsWith('@g.us');
  if (isGroup) {
    try {
      const meta = await conn.groupMetadata(remoteJid);
      const onlineList = [];
      for (const p of meta.participants) {
        try {
          const status = await conn.fetchStatus(p.id);
          if (status?.setAt) onlineList.push(`◈ @${p.id.split('@')[0]}`);
        } catch {}
      }
      if (!onlineList.length) return fReply(conn, m, '📡 No one appears online right now.', sessionName);
      await conn.sendMessage(remoteJid, {
        text: `📡 *Online Members*\n\n${onlineList.join('\n')}`,
        mentions: onlineList.map(l => `${l.replace('◈ @','')}@s.whatsapp.net`)
      }, { quoted: m });
    } catch (e) { await fReply(conn, m, `❌ Failed: ${e.message}`, sessionName); }
  } else {
    try {
      const status = await conn.fetchStatus(remoteJid);
      const num = remoteJid.split('@')[0];
      await fReply(conn, m,
        status
          ? `📡 *${num}*\n\nLast seen: ${status.setAt ? new Date(status.setAt * 1000).toLocaleString() : 'Hidden'}`
          : `📡 *${num}* — Status hidden or unavailable.`,
        sessionName
      );
    } catch (e) { await fReply(conn, m, `❌ Failed: ${e.message}`, sessionName); }
  }
});

const LINK_REGEX = /(https?:\/\/|www\.|chat\.whatsapp\.com\/|t\.me\/)[^\s]*/i;
function containsLink(text) { return LINK_REGEX.test(text || ''); }

async function handleStatus(conn, m, sessionName) {
  const autoView = getSessionSetting(sessionName, 'autoViewStatus', false);
  const autoLike = getSessionSetting(sessionName, 'autoLikeStatus', false);
  if (autoView || autoLike) await conn.readMessages([m.key]);
  if (autoLike) { try { await conn.sendMessage(m.key.remoteJid, { react: { text: '❤️', key: m.key } }); } catch {} }
}

async function handleDelete(conn, update, sessionName) {
  const enabled = getSessionSetting(sessionName, 'antidelete', false);
  if (!enabled) return;
  const keys = update?.keys || [];
  for (const key of keys) {
    const stored = getStoredMsg(sessionName, key.id);
    if (!stored) continue;
    const remoteJid = stored.key.remoteJid;
    const sender = normalizeNumber(stored.key.participant || stored.key.remoteJid);
    const msg = stored.message;
    if (!msg) continue;
    const header = `🔒 *Antidelete — NOVA-XMD*\n👤 @${sender}`;
    try {
      if (msg.conversation || msg.extendedTextMessage) {
        const text = msg.conversation || msg.extendedTextMessage?.text || '';
        await conn.sendMessage(remoteJid, { text: `${header}\n\n${text}`, mentions: [`${sender}@s.whatsapp.net`] });
      } else if (msg.imageMessage) {
        const buf = await downloadMedia(msg.imageMessage, 'image');
        await conn.sendMessage(remoteJid, { image: buf, caption: header, mentions: [`${sender}@s.whatsapp.net`] });
      } else if (msg.videoMessage) {
        const buf = await downloadMedia(msg.videoMessage, 'video');
        await conn.sendMessage(remoteJid, { video: buf, caption: header, mentions: [`${sender}@s.whatsapp.net`] });
      } else if (msg.audioMessage) {
        const buf = await downloadMedia(msg.audioMessage, 'audio');
        await conn.sendMessage(remoteJid, { audio: buf, mimetype: 'audio/mp4' });
      } else if (msg.stickerMessage) {
        const buf = await downloadMedia(msg.stickerMessage, 'sticker');
        await conn.sendMessage(remoteJid, { sticker: buf });
      } else {
        await conn.sendMessage(remoteJid, { text: `${header}\n[Deleted]`, mentions: [`${sender}@s.whatsapp.net`] });
      }
    } catch (e) { process.stdout.write(`[ANTIDELETE ERR] ${e.message}\n`); }
  }
}

async function handleAntilink(conn, m, sessionName, senderJid, botNumber) {
  const mode = getSessionSetting(sessionName, 'antilink', 'off');
  if (mode === 'off') return;
  const text = getMsgText(m);
  if (!containsLink(text)) return;
  const remoteJid = m.key.remoteJid;
  const senderNumber = normalizeNumber(senderJid);
  if (senderNumber === botNumber) return;
  if (await isGroupAdmin(conn, remoteJid, senderJid)) return;
  if (mode === 'del') {
    await conn.sendMessage(remoteJid, { delete: m.key });
  } else if (mode === 'warn') {
    await conn.sendMessage(remoteJid, { delete: m.key });
    const warns = getWarnings();
    const key = `${remoteJid}_${senderNumber}`;
    warns[key] = (warns[key] || 0) + 1;
    saveWarnings(warns);
    const count = warns[key];
    if (count >= 5) {
      await conn.groupParticipantsUpdate(remoteJid, [senderJid], 'remove');
      delete warns[key];
      saveWarnings(warns);
      await conn.sendMessage(remoteJid, { text: `👞 @${senderNumber} kicked after 5 link warnings.`, mentions: [senderJid] });
    } else {
      await conn.sendMessage(remoteJid, { text: `⚠️ @${senderNumber} no links! Warning ${count}/4. On 5th you're out.`, mentions: [senderJid] });
    }
  } else if (mode === 'kick') {
    await conn.sendMessage(remoteJid, { delete: m.key });
    await conn.groupParticipantsUpdate(remoteJid, [senderJid], 'remove');
  }
} // ✅ closing brace added

async function handleMessage(conn, m, sessionName, ownerNumber) {
  try {
    if (!m?.message) return;
    const remoteJid = m.key.remoteJid;
    if (remoteJid === 'status@broadcast') { await handleStatus(conn, m, sessionName); return; }
    if (m.message.ephemeralMessage) m.message = m.message.ephemeralMessage.message;
    storeMsg(sessionName, m);
    const senderJid = m.key.fromMe ? (conn.user.id) : (m.key.participant || remoteJid);
    const senderNumber = cleanJidNumber(senderJid);
    const botNumber = cleanJidNumber(conn.user.id);
    if (bannedUsers.has(senderNumber)) return;

    // Msg code filter — DMs only
    const msgCodeSettings = getMsgCodes();
    if (msgCodeSettings.enabled && !m.key.fromMe && !remoteJid.endsWith('@g.us')) {
      const allowed = msgCodeSettings.codes.some(code => senderNumber.startsWith(code));
      if (!allowed) {
        try { await conn.updateBlockStatus(senderJid, 'block'); } catch {}
        return;
      }
    }

    // Away message — DMs only
    const awaySettings = getAwaySettings();
    if (awaySettings.enabled && !m.key.fromMe && !remoteJid.endsWith('@g.us')) {
      try { await conn.sendMessage(remoteJid, { text: `🌙 *Away Message*\n\n${awaySettings.message}` }, { quoted: m }); } catch {}
    }

    if (remoteJid.endsWith('@g.us')) await handleAntilink(conn, m, sessionName, senderJid, botNumber);
    const userSettings = loadUserSettings(sessionName);
    const prefix = userSettings.prefix || settings.DEFAULT_PREFIX;
    const mode = userSettings.mode || 'public';
    const msgContent = getMsgText(m);

    // Bad word scanner
    const badWords = getBadWords();
    if (badWords.length && !m.key.fromMe) {
      const lower = msgContent.toLowerCase();
      const found = badWords.find(w => lower.includes(w));
      if (found) {
        try { await conn.sendMessage(remoteJid, { delete: m.key }); } catch {}
        return;
      }
    }

    if (!msgContent.startsWith(prefix)) {
  // Chatbot runs for EVERYONE — before self mode check
  const chatbotOn = getSessionSetting(sessionName, 'chatbot', false);
  if (chatbotOn && msgContent.trim()) {
    try {
      let reply = await httpsGet(`https://text.pollinations.ai/${encodeURIComponent(msgContent)}`);
      reply = reply.trim();
      if (reply.startsWith('{') || reply.startsWith('[')) {
        try {
          const parsed = JSON.parse(reply);
          reply = parsed?.choices?.[0]?.message?.content
            || parsed?.text
            || parsed?.response
            || parsed?.content
            || reply;
        } catch {}
      }
      reply = reply.replace(/^(<html|Moved|Redirecting)[^\n]*/i, '').trim();
      if (reply) await conn.sendMessage(remoteJid, { text: reply }, { quoted: m });
    } catch {}
    return;
  }

  if (mode === 'self' && !m.key.fromMe) return;

  // setdata reply capture
  if (global._dataPending?.[sessionName]?.waiting && msgContent.trim()) {
  const pending = global._dataPending[sessionName];
  const providerName = pending.provider;
  const packs = getDataPacks();
  packs[providerName] = msgContent.trim();
  saveDataPacks(packs);
  delete global._dataPending[sessionName];
  COMMANDS[providerName] = async (conn2, m2, args2, ctx2) => {
    const p = getDataPacks();
    const info = p[providerName];
    if (!info) return fReply(conn2, m2, `❌ No data pack for ${providerName}`, ctx2.sessionName);
    await fReply(conn2, m2, info, ctx2.sessionName);
  };
  await fReply(conn, m, `✅ *.${providerName}* is now live!\nUsers can type ${prefix}${providerName} to get your packages.`, ctx.sessionName);
  return;
}
}

    const body = msgContent.slice(prefix.length).trim();
    const [commandRaw, ...args] = body.split(' ');
    const command = commandRaw.toLowerCase();
    const storedOwner = cleanJidNumber(userSettings.ownerNumber || '');
    const isOwner = !!(senderNumber === cleanJidNumber(ownerNumber) || (storedOwner && senderNumber === storedOwner) || senderNumber === botNumber || m.key.fromMe);
    const isUserPremium = isPremium(senderNumber);
    let isAdmin = false;
    if (remoteJid.endsWith('@g.us')) isAdmin = await isGroupAdmin(conn, remoteJid, senderJid);
    if (mode === 'self' && !isOwner) return;
    const ctx = { prefix, sessionName, senderNumber, botNumber, isOwner, isUserPremium, isAdmin, args, command, senderJid };
    if (COMMANDS[command]) await COMMANDS[command](conn, m, args, ctx);
  } catch (err) { process.stdout.write(`[NOVA-XMD ERROR] ${err.message}\n`); }
}
registerCmd('movie', async (conn, m, args, ctx) => {
  const query = args.join(' ');
  if (!query) return fReply(conn, m, `Usage: ${ctx.prefix}movie <title>`, ctx.sessionName);
  await fReply(conn, m, `🎬 _Searching for_ *${query}*...`, ctx.sessionName);
  try {
    const data = await httpsGet(`https://www.omdbapi.com/?t=${encodeURIComponent(query)}&apikey=trilogy`);
    const m2 = JSON.parse(data);
    if (m2.Response === 'False') return fReply(conn, m, `❌ Movie not found: ${query}`, ctx.sessionName);
    const ratings = m2.Ratings?.map(r => `◈ ${r.Source}: ${r.Value}`).join('\n') || 'N/A';
    const text =
      `🎬 *${m2.Title}* (${m2.Year})\n\n` +
      `📌 *Genre:* ${m2.Genre}\n` +
      `⏱️ *Runtime:* ${m2.Runtime}\n` +
      `🌍 *Country:* ${m2.Country}\n` +
      `🗣️ *Language:* ${m2.Language}\n` +
      `🎭 *Actors:* ${m2.Actors}\n` +
      `🎬 *Director:* ${m2.Director}\n` +
      `✍️ *Writer:* ${m2.Writer}\n\n` +
      `📖 *Plot:*\n${m2.Plot}\n\n` +
      `⭐ *Ratings:*\n${ratings}\n\n` +
      `🏆 *Awards:* ${m2.Awards}\n` +
      `📦 *Box Office:* ${m2.BoxOffice || 'N/A'}\n\n` +
      `_Powered by LUMINAR Inc 🇰🇪_`;
    if (m2.Poster && m2.Poster !== 'N/A') {
      await conn.sendMessage(m.key.remoteJid, {
        image: { url: m2.Poster },
        caption: text
      }, { quoted: m });
    } else {
      await fReply(conn, m, text, ctx.sessionName);
    }
  } catch (e) { await fReply(conn, m, `❌ Failed: ${e.message}`, ctx.sessionName); }
});
module.exports = { handleMessage, handleDelete, storeMsg, COMMANDS };