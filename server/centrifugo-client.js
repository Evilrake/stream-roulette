const WebSocket = require('ws');

/**
 * Общий lifecycle Centrifugo (DA / DonatePay):
 * connect → auth token → subscribe → donations → reconnect.
 *
 * Платформа передаёт:
 * - wsUrl
 * - prepare(): { socketToken, channel, statusExtra? }
 * - getSubscribeToken(clientId, channel)
 * - extractDonation(msg) → payload | null
 * - onDonation / onStatus
 */
function createCentrifugoClient({
  wsUrl,
  prepare,
  getSubscribeToken,
  extractDonation,
  onDonation,
  onStatus,
  missingTokenError = 'Токен не задан',
  reconnectMs = 5000
}) {
  let ws = null;
  let closed = false;
  let reconnectTimer = null;
  let msgId = 1;

  function status(payload) {
    if (onStatus) onStatus(payload);
  }

  function nextId() {
    return msgId++;
  }

  function scheduleReconnect() {
    if (closed) return;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => connect(), reconnectMs);
  }

  async function connect() {
    if (closed) return;

    try {
      const prepared = await prepare();
      if (!prepared) {
        status({ connected: false, error: missingTokenError });
        return;
      }

      const { socketToken, channel, statusExtra = {} } = prepared;
      if (!socketToken || !channel) {
        status({ connected: false, error: 'Нет socket token или channel' });
        return;
      }

      ws = new WebSocket(wsUrl);

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
            status({ connected: true, channel, ...statusExtra });
          } catch (err) {
            status({ connected: false, error: String(err.message || err) });
          }
          return;
        }

        const donation = extractDonation(msg);
        if (donation) onDonation(donation);
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

  function stop() {
    closed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
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

module.exports = { createCentrifugoClient };
