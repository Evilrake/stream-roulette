const WebSocket = require('ws');

/**
 * DonatePay Centrifugo realtime (как в публичных интеграциях ODA / виджетах).
 * Нужен API access_token из кабинета DonatePay.
 */
function createDonatePayClient({ accessToken, region = 'ru', onDonation, onStatus }) {
  let ws = null;
  let closed = false;
  let reconnectTimer = null;
  let msgId = 1;

  const isEu = String(region).toLowerCase() === 'eu';
  const host = isEu ? 'donatepay.eu' : 'donatepay.ru';
  const DP_WS = `wss://centrifugo.${host}:443/connection/websocket`;
  const DP_SOCKET_TOKEN = `https://${host}/api/v2/socket/token`;
  const DP_USER = `https://${host}/api/v1/user`;
  // ODA-прокси — запасной способ получить user id для .ru
  const ODA_USER = 'https://api.oda.digital/donatepay/user';

  function status(payload) {
    if (onStatus) onStatus(payload);
  }

  function nextId() {
    return msgId++;
  }

  async function postJson(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      throw new Error(`DonatePay ${res.status}: ${text.slice(0, 200)}`);
    }
    return data;
  }

  async function fetchUserId() {
    const url = `${DP_USER}?access_token=${encodeURIComponent(accessToken)}`;
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (res.ok) {
        const data = await res.json();
        const id = data?.data?.id ?? data?.id;
        if (id != null) return String(id);
      }
    } catch {
      /* try fallback */
    }

    if (!isEu) {
      const res = await fetch(
        `${ODA_USER}?access_token=${encodeURIComponent(accessToken)}`,
        { headers: { Accept: 'application/json' } }
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Не удалось получить user id DonatePay: ${res.status} ${text.slice(0, 160)}`);
      }
      const data = await res.json();
      const id = data?.data?.id ?? data?.id;
      if (id == null) throw new Error('DonatePay: в ответе нет user id');
      return String(id);
    }

    throw new Error('DonatePay: не удалось получить user id');
  }

  async function getConnectionToken() {
    const data = await postJson(DP_SOCKET_TOKEN, { access_token: accessToken });
    const token = data?.token;
    if (!token) throw new Error('DonatePay: нет socket token');
    return token;
  }

  async function getSubscribeToken(clientId, channel) {
    const data = await postJson(DP_SOCKET_TOKEN, {
      access_token: accessToken,
      channels: [channel],
      client: clientId
    });
    const channels = data?.channels || [];
    const item = channels.find((c) => c.channel === channel) || channels[0];
    if (!item?.token) throw new Error('DonatePay: нет subscription token');
    return item.token;
  }

  async function connect() {
    if (closed) return;
    if (!accessToken) {
      status({ connected: false, error: 'Нет API-токена DonatePay' });
      return;
    }

    try {
      const userId = await fetchUserId();
      const channel = `$public:${userId}`;
      const socketToken = await getConnectionToken();

      ws = new WebSocket(DP_WS);

      ws.on('open', () => {
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
            status({ connected: true, channel, userId, region: isEu ? 'eu' : 'ru' });
          } catch (err) {
            status({ connected: false, error: String(err.message || err) });
          }
          return;
        }

        const notification =
          msg.result?.data?.data?.notification ||
          msg.push?.pub?.data?.notification ||
          msg.pub?.data?.notification ||
          null;

        if (notification) {
          handleDonationPayload(notification);
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
    const vars = data.vars || data;
    const id = data.id != null ? String(data.id) : null;
    const amount = Number(vars.sum ?? vars.amount ?? data.sum ?? data.amount);
    const username = vars.name || vars.username || data.name || 'Донатер';
    const message = vars.comment || vars.message || data.comment || data.message || '';
    if (!Number.isFinite(amount) || amount <= 0) return;
    onDonation({
      amount,
      username,
      message,
      externalId: id ? `donatepay_${id}` : null,
      source: 'donatepay',
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

module.exports = { createDonatePayClient };
