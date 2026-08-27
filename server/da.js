const { createCentrifugoClient } = require('./centrifugo-client');

const DA_WS = 'wss://centrifugo.donationalerts.com/connection/websocket';
const DA_API = 'https://www.donationalerts.com/api/v1';

/**
 * Donation Alerts Centrifugo (протокол как в официальном apidoc).
 * Нужны DA_ACCESS_TOKEN; DA_USER_ID опционален (берётся из /user/oauth).
 */
function createDonationAlertsClient({ accessToken, userId, onDonation, onStatus }) {
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

  return createCentrifugoClient({
    wsUrl: DA_WS,
    missingTokenError: 'DA_ACCESS_TOKEN не задан',
    onStatus,
    prepare: async () => {
      if (!accessToken) return null;
      const data = await fetchJson(`${DA_API}/user/oauth`);
      const socketToken = data?.data?.socket_connection_token;
      const id = data?.data?.id ?? userId;
      if (!socketToken) throw new Error('Нет socket_connection_token от DA');
      if (!id) throw new Error('Нет user id — укажи DA_USER_ID в .env');
      const uid = String(id);
      return {
        socketToken,
        channel: `$alerts:donation_${uid}`,
        statusExtra: { userId: uid }
      };
    },
    getSubscribeToken: async (clientId, channel) => {
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
    },
    extractDonation: (msg) => {
      const donation =
        msg.result?.data?.data ||
        msg.push?.pub?.data ||
        msg.pub?.data ||
        null;
      if (!donation) return null;
      if (donation.amount == null && donation.amount_in_user_currency == null) {
        return null;
      }
      const id = donation.id != null ? String(donation.id) : null;
      const amount = Number(
        donation.amount_in_user_currency ?? donation.amount_main ?? donation.amount
      );
      const username = donation.username || donation.name || 'Донатер';
      const message = donation.message || '';
      if (!Number.isFinite(amount) || amount <= 0) return null;
      return {
        amount,
        username,
        message,
        externalId: id,
        source: 'donationalerts',
        raw: donation
      };
    },
    onDonation
  });
}

module.exports = { createDonationAlertsClient };
