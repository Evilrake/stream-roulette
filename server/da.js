const WebSocket = require('ws');

const DA_WS = 'wss://centrifugo.donationalerts.com/connection/websocket';
const DA_API = 'https://www.donationalerts.com/api/v1';

/**
 * Donation Alerts Centrifugo (протокол как в официальном apidoc).
 * Нужны DA_ACCESS_TOKEN; DA_USER_ID опционален (берётся из /user/oauth).
 */
function createDonationAlertsClient({ accessToken, userId, onDonation, onStatus }) {
  let ws = null;
  let closed = false;
  let reconnectTimer = null;
  let msgId = 1;

  function status(payload) {
    if (onStatus) onStatus(payload);
  }

  async function fetchJson(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`DA API ${res.status}: ${text}`);
    }
    return res.json();
  }

  async function getSocketToken() {
    const data = await fetchJson(`${DA_API}/user/oauth`);
    const socketToken = data?.data?.socket_connection_token;
    const id = data?.data?.id ?? userId;
    if (!socketToken) throw new Error('Нет socket_connection_token от DA');
    if (!id) throw new Error('Нет user id — укажи DA_USER_ID в .env');
    return { socketToken, userId: String(id) };
  }

  async function getSubscribeToken(clientId, channel) {
    const data = await fetchJson(`${DA_API}/centrifuge/subscribe`, {
      method: 'POST',
      body: JSON.stringify({
        channels: [channel],
        client: clientId
      })
    });
    const channels = data?.channels || [];
    const item = channels.find((c) => c.channel === channel) || channels[0];
    if (!item?.token) throw new Error('Нет subscription token от DA');
    return item.token;
  }

  function nextId() {
    return msgId++;
  }

  async function connect() {
    if (closed) return;
    if (!accessToken) {
      status({ connected: false, error: 'DA_ACCESS_TOKEN не задан' });
      return;
    }

    try {
      const { socketToken, userId: uid } = await getSocketToken();
      const channel = `$alerts:donation_${uid}`;

      ws = new WebSocket(DA_WS);

      ws.on('open', () => {
        // Centrifugo v1-style auth (как в документации DA)
        ws.send(
          JSON.stringify({
            params: { token: socketToken },
            id: nextId()
          })
        );
      });

      ws.on('message', async (raw) => {
        let msg;
        try {
          msg = JSON.parse(String(raw));
        } catch {
          return;
        }

        // Auth response → client id
        if (msg.result?.client && msg.id) {
          const clientId = msg.result.client;
          try {
            const subToken = await getSubscribeToken(clientId, channel);
            ws.send(
              JSON.stringify({
                id: nextId(),
                method: 1,
                params: { channel, token: subToken }
              })
            );
            status({ connected: true, channel, userId: uid });
          } catch (err) {
            status({ connected: false, error: String(err.message || err) });
          }
          return;
        }

        // Push donation: result.data.data
        const donation =
          msg.result?.data?.data ||
          msg.push?.pub?.data ||
          msg.pub?.data ||
          null;

        if (donation && (donation.amount != null || donation.amount_in_user_currency != null)) {
          handleDonationPayload(donation);
        }
      });

      ws.on('close', () => {
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

  function handleDonationPayload(data) {
    const id = data.id != null ? String(data.id) : null;
    const amount = Number(
      data.amount_in_user_currency ?? data.amount_main ?? data.amount
    );
    const username = data.username || data.name || 'Донатер';
    const message = data.message || '';
    if (!Number.isFinite(amount) || amount <= 0) return;
    onDonation({
      amount,
      username,
      message,
      externalId: id,
      source: 'donationalerts',
      raw: data
    });
  }

  function scheduleReconnect() {
    if (closed) return;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => connect(), 5000);
  }

  function stop() {
    closed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (ws) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
  }

  return { connect, stop };
}

module.exports = { createDonationAlertsClient };
