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
const pino = require('pino');
const { Telegraf, Markup } = require('telegraf');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  DisconnectReason
} = require('@trashcore/baileys');

const settings = require('./settings');
const { handleMessage, handleDelete, storeMsg, COMMANDS } = require('./case');
const {
  deleteSession, listSessions, getSessionDir,
  loadUserSettings, saveUserSettings, normalizeNumber
} = require('./helper/function');
const { sleep, cleanNumber } = require('./helper/utils');

global.botStartTime = global.botStartTime || Date.now();

// ─── Dirs ──────────────────────────────────────────────────────────────────────
fs.mkdirSync(settings.SESSIONS_DIR, { recursive: true });
fs.mkdirSync('./database', { recursive: true });

// ─── State ─────────────────────────────────────────────────────────────────────
const activeSessions = new Map(); // sessionName → { conn, ownerNumber, telegramChatId }

// ─── Telegram ──────────────────────────────────────────────────────────────────
const bot = new Telegraf(settings.TELEGRAM_TOKEN);

// ─── Auto-follow newsletters + auto-join groups ────────────────────────────────
async function runAutoJoins(conn, sessionName) {
  const us = loadUserSettings(sessionName);

  // Auto-follow newsletters (max 2)
  const newsletters = us.newsletters || [];
  for (const link of newsletters.slice(0, 2)) {
    try {
      await conn.newsletterFollow(link);
      process.stdout.write(`[AUTO-NEWSLETTER] ${sessionName} → ${link}\n`);
    } catch {}
    await sleep(1000);
  }

  // Auto-join groups (max 2)
  const groups = us.autoJoinGroups || [];
  for (const link of groups.slice(0, 2)) {
    try {
      const code = link.split('https://chat.whatsapp.com/')[1];
      if (code) {
        await conn.groupAcceptInvite(code);
        process.stdout.write(`[AUTO-JOIN] ${sessionName} → ${link}\n`);
      }
    } catch {}
    await sleep(1000);
  }
}

// ─── WA session starter ────────────────────────────────────────────────────────
async function startWASession(sessionName, telegramChatId, ownerNumber) {
  const sessionDir = getSessionDir(sessionName);
  fs.mkdirSync(sessionDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version } = await fetchLatestBaileysVersion();

  const conn = makeWASocket({
    version,
    keepAliveIntervalMs: 10000,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
    },
    browser: ['Ubuntu', 'Opera', '100.0.4815.0'],
    syncFullHistory: false,
    // Enable group participant metadata for correct admin detection
    getMessage: async (key) => {
      return { conversation: '' };
    }
  });

  conn.ev.on('creds.update', saveCreds);

  // Pairing code
  if (!state.creds.registered) {
    await sleep(3000);
    try {
      const pairCode = await conn.requestPairingCode(ownerNumber);
      if (telegramChatId) {
        await bot.telegram.sendMessage(
          telegramChatId,
          `🔗 *Pairing Code for session* \`${sessionName}\`:\n\n` +
          `\`${pairCode}\`\n\n` +
          `Enter this code on WhatsApp → Linked Devices → Link a device.`,
          { parse_mode: 'Markdown' }
        ).catch(() => {});
      }
      process.stdout.write(`[PAIR] ${sessionName} → ${pairCode}\n`);
    } catch (err) {
      process.stdout.write(`[PAIR ERROR] ${sessionName}: ${err.message}\n`);
    }
  }

  // Connection events
  conn.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const session = activeSessions.get(sessionName);
      const storedChatId = session?.telegramChatId || telegramChatId;
      activeSessions.delete(sessionName);

      if (code !== DisconnectReason.loggedOut) {
        process.stdout.write(`[RECONNECT] ${sessionName}\n`);
        await sleep(3000);
        startWASession(sessionName, null, ownerNumber);
      } else {
        process.stdout.write(`[LOGGED OUT] ${sessionName}\n`);
        if (storedChatId) {
          await bot.telegram.sendMessage(
            storedChatId,
            `⚠️ Session *${sessionName}* was logged out.\nUse /pair to reconnect.`,
            { parse_mode: 'Markdown' }
          ).catch(() => {});
        }
      }
    }

    if (connection === 'open') {
      const botNum = normalizeNumber(conn.user.id);
      process.stdout.write(`[CONNECTED] ${sessionName} → ${botNum}\n`);

      activeSessions.set(sessionName, {
        conn,
        ownerNumber: ownerNumber || botNum,
        telegramChatId: telegramChatId || null
      });

      // Persist telegramChatId + ownerNumber
      const us = loadUserSettings(sessionName);
      if (telegramChatId) us.telegramChatId = telegramChatId;
      us.ownerNumber = ownerNumber || botNum;
      saveUserSettings(sessionName, us);

      // Connection success message to Telegram
      const chatTarget = telegramChatId || us.telegramChatId;
      if (chatTarget) {
        const userInfo = conn.user?.name || botNum;
        await bot.telegram.sendMessage(
          chatTarget,
          `✅ *NUMBER CONNECTED*\n\n` +
          `👤 *user :* ${userInfo}\n` +
          `📡 *session :* \`${sessionName}\`\n` +
          `👑 *owner :* ${settings.OWNER_HANDLE}`,
          { parse_mode: 'Markdown' }
        ).catch(() => {});
      }

      // Run auto-joins after connect
      await runAutoJoins(conn, sessionName);
    }
  });

  // Messages handler
  conn.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const m = messages?.[0];
    if (!m?.message) return;
    const session = activeSessions.get(sessionName);
    if (!session) return;
    await handleMessage(conn, m, sessionName, session.ownerNumber);
  });

  // Antidelete — listen for message deletes
  conn.ev.on('messages.delete', async (update) => {
    await handleDelete(conn, update, sessionName);
  });

  return conn;
}

// ─── Reload all existing sessions ─────────────────────────────────────────────
async function reloadExistingSessions() {
  const sessions = listSessions();
  process.stdout.write(`[STARTUP] Reloading ${sessions.length} session(s)...\n`);
  for (const sessionName of sessions) {
    const us = loadUserSettings(sessionName);
    const ownerNumber = us.ownerNumber || '';
    process.stdout.write(`[RELOAD] ${sessionName}\n`);
    await startWASession(sessionName, null, ownerNumber);
    await sleep(2500);
  }
}

// ─── Telegram: /start ─────────────────────────────────────────────────────────
bot.command('start', async (ctx) => {
  const firstName = ctx.from.first_name || 'there';
  const caption =
    `👋 *Hello, ${firstName}!*\n\n` +
    `Welcome to *${settings.BOT_NAME}*\n\n` +
    `📌 *Commands:*\n` +
    `/pair <number> - Connect a WhatsApp number\n` +
    `/delsession - Delete a session\n` +
    `/listsession - List all sessions (owner)\n` +
    `/reportissue <text> - Report a problem\n\n` +
    `_Use /pair to get started!_`;

  const buttons = Markup.inlineKeyboard([
    [
      Markup.button.url('📢 Join Channel', settings.CHANNEL_LINK),
      Markup.button.url('👥 Join Group', settings.GROUP_LINK)
    ]
  ]);

  try {
    await ctx.replyWithPhoto(
      { url: settings.MENU_IMAGE },
      { caption, parse_mode: 'Markdown', ...buttons }
    );
  } catch {
    await ctx.reply(caption, { parse_mode: 'Markdown', ...buttons });
  }
});

// ─── Telegram: /pair — unlimited sessions ─────────────────────────────────────
bot.command('pair', async (ctx) => {
  const chatId = ctx.chat.id;
  const parts = ctx.message.text.split(' ');

  if (parts.length < 2) {
    return ctx.reply('📱 Usage: `/pair <number>`\nExample: `/pair 2547XXXXXXXX`', { parse_mode: 'Markdown' });
  }

  const ownerNumber = cleanNumber(parts[1]);
  if (ownerNumber.length < 7) {
    return ctx.reply('❌ Invalid number. Include country code.', { parse_mode: 'Markdown' });
  }

  // Unique session name per pairing — allows unlimited
  const sessionName = `session_${chatId}_${Date.now()}`;

  await ctx.reply(
    `⏳ Generating pairing code for \`${ownerNumber}\`...\nSession: \`${sessionName}\``,
    { parse_mode: 'Markdown' }
  );

  // Pre-save session settings
  const sessionDir = getSessionDir(sessionName);
  fs.mkdirSync(sessionDir, { recursive: true });
  const us = loadUserSettings(sessionName);
  us.ownerNumber = ownerNumber;
  us.telegramChatId = chatId;
  saveUserSettings(sessionName, us);

  await startWASession(sessionName, chatId, ownerNumber);
});

// ─── Telegram: /delsession ────────────────────────────────────────────────────
bot.command('delsession', async (ctx) => {
  const chatId = ctx.chat.id;
  const parts = ctx.message.text.split(' ');

  if (parts.length < 2) {
    const allSessions = listSessions();
    const mySessions = allSessions.filter(s => {
      try { return String(loadUserSettings(s).telegramChatId) === String(chatId); } catch { return false; }
    });

    if (!mySessions.length) return ctx.reply('⚠️ You have no sessions.');
    const list = mySessions.map(s => {
      const isActive = activeSessions.has(s);
      return `• \`${s}\` ${isActive ? '🟢' : '🔴'}`;
    }).join('\n');
    return ctx.reply(
      `📋 Your sessions:\n${list}\n\nUse: \`/delsession <session_name>\``,
      { parse_mode: 'Markdown' }
    );
  }

  const sessionName = parts[1].trim();

  try {
    const us = loadUserSettings(sessionName);
    if (String(us.telegramChatId) !== String(chatId) && chatId !== settings.OWNER_ID) {
      return ctx.reply('❌ That session does not belong to you.');
    }
  } catch {
    return ctx.reply('❌ Session not found.');
  }

  if (activeSessions.has(sessionName)) {
    try { activeSessions.get(sessionName).conn.end(); } catch {}
    activeSessions.delete(sessionName);
  }

  const deleted = deleteSession(sessionName);
  await ctx.reply(
    deleted
      ? `✅ Session \`${sessionName}\` deleted. Use /pair to connect a new number.`
      : '⚠️ Session not found.',
    { parse_mode: 'Markdown' }
  );
});

// ─── Telegram: /listsession (owner only) ──────────────────────────────────────
bot.command('listsession', async (ctx) => {
  if (ctx.chat.id !== settings.OWNER_ID) return ctx.reply('❌ Owner only.');
  const sessions = listSessions();
  if (!sessions.length) return ctx.reply('📂 No sessions found.');

  let msg = `📋 *Sessions (${sessions.length}):*\n\n`;
  for (const name of sessions) {
    const isActive = activeSessions.has(name);
    const us = loadUserSettings(name);
    const num = activeSessions.get(name)?.ownerNumber || us.ownerNumber || '?';
    msg += `• \`${name}\` ${isActive ? '🟢' : '🔴'} — ${num}\n`;
  }
  await ctx.reply(msg, { parse_mode: 'Markdown' });
});

// ─── Telegram: /reportissue ───────────────────────────────────────────────────
bot.command('reportissue', async (ctx) => {
  const text = ctx.message.text.split(' ').slice(1).join(' ').trim();
  if (!text) return ctx.reply('📝 Usage: `/reportissue <your problem>`', { parse_mode: 'Markdown' });

  const from = ctx.from;
  const report =
    `🚨 *Issue Report*\n\n` +
    `👤 ${from.first_name || ''} ${from.last_name || ''}\n` +
    `🆔 \`${from.id}\`\n` +
    `📛 ${from.username ? '@' + from.username : 'N/A'}\n\n` +
    `📋 *Issue:*\n${text}`;

  try {
    await bot.telegram.sendMessage(settings.REPORT_CHAT, report, { parse_mode: 'Markdown' });
    await ctx.reply('✅ Report sent to owner. Thank you!');
  } catch {
    await ctx.reply('❌ Failed to send report. Try again later.');
  }
});

// ─── Launch ────────────────────────────────────────────────────────────────────
(async () => {
  process.stdout.write(`[BOOT] ${settings.BOT_NAME} starting...\n`);
  await reloadExistingSessions();
  bot.launch({ dropPendingUpdates: true });
  process.stdout.write(`[TELEGRAM] Bot online.\n`);
  process.once('SIGINT', () => { bot.stop('SIGINT'); process.exit(0); });
  process.once('SIGTERM', () => { bot.stop('SIGTERM'); process.exit(0); });
})();
