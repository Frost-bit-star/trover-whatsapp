// config.js

module.exports = {
  session: {
    creds: {
      noiseKey: {
        private: { type: "Buffer", data: "sFKKJ7dpYtj/qy+EoCS6Vqgxustt2ub2uA1guXX0Sn4=" },
        public: { type: "Buffer", data: "lsvvkZEsh23nlo112H5vco0WF/mJaPKcZ6SgDAPCMzU=" }
      },
      pairingEphemeralKeyPair: {
        private: { type: "Buffer", data: "YCKoco5egn69OrZLJzeA/RShx5RfqlTL3HMCXihsLGw=" },
        public: { type: "Buffer", data: "cj7s98Sl5sJPEuBdJwf2s1xyutDFX4O4lRjlSHYJmGk=" }
      },
      signedIdentityKey: {
        private: { type: "Buffer", data: "qDGcDx5SuKwdy+jAytJllHZVin8IQZEb4EE7s8VeImg=" },
        public: { type: "Buffer", data: "o9U8/sMUez7GqrBm0j+7PVUcHQLw3YDMjPOIM13hJlk=" }
      },
      signedPreKey: {
        keyPair: {
          private: { type: "Buffer", data: "IM3jJAGfnU0xOU4SBtV6z3j9RPY7LT0kxA7sM4WL82w=" },
          public: { type: "Buffer", data: "YEGMWVmqqlTCNCRoWGueg2IJr5yoJWNrt4YiIvWW1Q4=" }
        },
        signature: { type: "Buffer", data: "/JUm9VCn4WwKkxGKMf8PJI5hCXAzDx5JaCQRAtqpT+SUl/L403dHsr+tE58msC0sDzIrpg8FkR71AGSo9ylFjA==" },
        keyId: 1
      },
      registrationId: 152,
      advSecretKey: "+7r1rA2WwBABy+CIx9DfRJAJQLeHJ+csFybCIjFp54g=",
      processedHistoryMessages: [
        {
          key: {
            remoteJid: "255776822641@s.whatsapp.net",
            fromMe: true,
            id: "1CB29F9BB5491F3EA037D38DD3E13E28"
          },
          messageTimestamp: 1748789013
        }
      ],
      nextPreKeyId: 31,
      firstUnuploadedPreKeyId: 31,
      accountSyncCounter: 0,
      accountSettings: { unarchiveChats: false },
      registered: true,
      pairingCode: "YLGTCUB3",
      me: {
        id: "255776822641:9@s.whatsapp.net",
        lid: "193493158875279:9@lid"
      },
      account: {
        details: "CNvZ580FEIXO8cEGGAIgACgA",
        accountSignatureKey: "6B04045/Oj2pUZbrzyj5nvKp3bc5WvKn3qrIheDfBQU=",
        accountSignature: "4AvUupYRU8xQegP6Z04gZ+LKnGl+tLN4FCExZ5g9TX+anJYOiKyY33aqBb6n1k93Octw5J8BGHkl7rq6sKTgDQ==",
        deviceSignature: "GwwSgCqgG2s4+UFE5HU8oLksRzu9lJ1Za7T/aWa8Vr8hOOvqJTt0TbMspBx1WvXWmpGcMFzy4Av008bAbPMejQ=="
      },
      signalIdentities: [
        {
          identifier: {
            name: "255776822641:9@s.whatsapp.net",
            deviceId: 0
          },
          identifierKey: {
            type: "Buffer",
            data: "BegdONOOfzo9qVGW688o+Z7yqd23OVryp96qyIXg3wUF"
          }
        }
      ],
      platform: "android",
      routingInfo: {
        type: "Buffer",
        data: "CA0ICA=="
      },
      lastAccountSyncTimestamp: 1748789007,
      lastPropHash: "3gPUJk",
      myAppStateKeyId: "AAAAAMdt"
    },
    keys: {
      // Leave empty or fill with your saved keys if you have them
      "pre-key": {},
      session: {},
      "sender-key": {},
      "app-state-sync-key": {},
      "sender-key-memory": {}
    }
  }
};