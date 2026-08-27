const { createCentrifugoClient } = require('./centrifugo-client');

/**
 * DonatePay Centrifugo realtime (как в публичных интеграциях ODA / виджетах).
 * Нужен API access_token из кабинета DonatePay.
 */
function createDonatePayClient({ accessToken, region = 'ru', onDonation, onStatus }) {
  const isEu = String(region).toLowerCase() === 'eu';
  const host = isEu ? 'donatepay.eu' : 'donatepay.ru';
  const DP_WS = `wss://centrifugo.${host}:443/connection/websocket`;
  const DP_SOCKET_TOKEN = `https://${host}/api/v2/socket/token`;
  const DP_USER = `https://${host}/api/v1/user`;
  const ODA_USER = 'https://api.oda.digital/donatepay/user';

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
        throw new Error(
          `Не удалось получить user id DonatePay: ${res.status} ${text.slice(0, 160)}`
        );
      }
      const data = await res.json();
      const id = data?.data?.id ?? data?.id;
      if (id == null) throw new Error('DonatePay: в ответе нет user id');
      return String(id);
    }

    throw new Error('DonatePay: не удалось получить user id');
  }

  return createCentrifugoClient({
    wsUrl: DP_WS,
    missingTokenError: 'Нет API-токена DonatePay',
    onStatus,
    prepare: async () => {
      if (!accessToken) return null;
      const userId = await fetchUserId();
      const socketToken = (await postJson(DP_SOCKET_TOKEN, { access_token: accessToken }))
        ?.token;
      if (!socketToken) throw new Error('DonatePay: нет socket token');
      return {
        socketToken,
        channel: `$public:${userId}`,
        statusExtra: { userId, region: isEu ? 'eu' : 'ru' }
      };
    },
    getSubscribeToken: async (clientId, channel) => {
      const data = await postJson(DP_SOCKET_TOKEN, {
        access_token: accessToken,
        channels: [channel],
        client: clientId
      });
      const channels = data?.channels || [];
      const item = channels.find((c) => c.channel === channel) || channels[0];
      if (!item?.token) throw new Error('DonatePay: нет subscription token');
      return item.token;
    },
    extractDonation: (msg) => {
      const notification =
        msg.result?.data?.data?.notification ||
        msg.push?.pub?.data?.notification ||
        msg.pub?.data?.notification ||
        null;
      if (!notification) return null;
      const vars = notification.vars || notification;
      const id = notification.id != null ? String(notification.id) : null;
      const amount = Number(
        vars.sum ?? vars.amount ?? notification.sum ?? notification.amount
      );
      const username =
        vars.name || vars.username || notification.name || 'Донатер';
      const message =
        vars.comment ||
        vars.message ||
        notification.comment ||
        notification.message ||
        '';
      if (!Number.isFinite(amount) || amount <= 0) return null;
      return {
        amount,
        username,
        message,
        externalId: id ? `donatepay_${id}` : null,
        source: 'donatepay',
        raw: notification
      };
    },
    onDonation
  });
}

module.exports = { createDonatePayClient };
