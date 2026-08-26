const WebSocket = require('ws');

const DONATEX_HUB = 'https://donatex.gg/api/public-donations-hub';
const RECORD_SEP = '\x1e';

/**
 * DonateX realtime через SignalR (JSON protocol) без @microsoft/signalr.
 * Токен: кабинет DonateX → Настройки → «API и Доступ».
 */
function createDonateXClient({ accessToken, onDonation, onStatus }) {
  let ws = null;
  let closed = false;
  let reconnectTimer = null;
  let pingTimer = null;

  function status(payload) {
    if (onStatus) onStatus(payload);
  }

  function clearTimers() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (pingTimer) clearInterval(pingTimer);
    reconnectTimer = null;
    pingTimer = null;
  }

  function handleDonationPayload(donation) {
    if (!donation || typeof donation !== 'object') return;
    const id = donation.id != null ? String(donation.id) : null;
    const amount = Number(
      donation.amountInRub ?? donation.amount ?? donation.sum ?? donation.AmountInRub
    );
    const username =
      donation.username || donation.name || donation.Nickname || donation.UserName || 'Донатер';
    const message = donation.message || donation.comment || donation.Message || '';
    if (!Number.isFinite(amount) || amount <= 0) return;
    onDonation({
      amount,
      username,
      message,
      externalId: id ? `donatex_${id}` : null,
      source: 'donatex',
      raw: donation
    });
  }

  function handleSignalRMessage(msg) {
    // type 1 = Invocation
    if (msg.type === 1 && msg.target) {
      const target = String(msg.target);
      if (target.toLowerCase() === 'donationcreated') {
        const args = Array.isArray(msg.arguments) ? msg.arguments : [];
        handleDonationPayload(args[0]);
      }
      return;
    }
    // type 6 = Ping → reply with ping
    if (msg.type === 6 && ws?.readyState === 1) {
      ws.send(`{"type":6}${RECORD_SEP}`);
    }
  }

  async function negotiate() {
    const url =
      `${DONATEX_HUB}/negotiate?negotiateVersion=1` +
      `&access_token=${encodeURIComponent(accessToken)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: '{}'
    });
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`DonateX negotiate: не JSON (${res.status})`);
    }
    if (!res.ok) {
      throw new Error(
        `DonateX negotiate ${res.status}: ${(data.error || text || '').toString().slice(0, 180)}`
      );
    }
    return data;
  }

  function buildWsUrl(negotiateData) {
    const token =
      negotiateData.connectionToken || negotiateData.connectionId || '';
    let base = negotiateData.url || DONATEX_HUB;
    base = String(base).replace(/^http/i, 'ws');
    const sep = base.includes('?') ? '&' : '?';
    return (
      `${base}${sep}id=${encodeURIComponent(token)}` +
      `&access_token=${encodeURIComponent(accessToken)}`
    );
  }

  async function connect() {
    if (closed) return;
    if (!accessToken) {
      status({ connected: false, error: 'Нет API-токена DonateX' });
      return;
    }

    clearTimers();
    if (ws) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      ws = null;
    }

    try {
      status({ connected: false, error: 'подключение…' });
      const negotiated = await negotiate();
      const wsUrl = buildWsUrl(negotiated);

      ws = new WebSocket(wsUrl);

      ws.on('open', () => {
        ws.send(`{"protocol":"json","version":1}${RECORD_SEP}`);
      });

      ws.on('message', (raw) => {
        const text = String(raw);
        const parts = text.split(RECORD_SEP).filter(Boolean);
        for (const part of parts) {
          let msg;
          try {
            msg = JSON.parse(part);
          } catch {
            continue;
          }
          // Handshake reply is often {}
          if (msg.type == null && Object.keys(msg).length === 0) {
            status({ connected: true });
            pingTimer = setInterval(() => {
              if (ws?.readyState === 1) {
                ws.send(`{"type":6}${RECORD_SEP}`);
              }
            }, 15000);
            continue;
          }
          handleSignalRMessage(msg);
        }
      });

      ws.on('close', () => {
        clearTimers();
        if (closed) return;
        status({ connected: false, error: 'disconnected' });
        scheduleReconnect();
      });

      ws.on('error', (err) => {
        status({ connected: false, error: String(err.message || err) });
      });
    } catch (err) {
      status({ connected: false, error: String(err.message || err) });
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (closed) return;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => connect(), 5000);
  }

  function stop() {
    closed = true;
    clearTimers();
    if (ws) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      ws = null;
    }
  }

  return { connect, stop };
}

module.exports = { createDonateXClient };
