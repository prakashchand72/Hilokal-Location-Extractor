// ==UserScript==
// @name         Hilokal group-call-card extractor
// @namespace    hilokal-gcc-extract
// @version      2.2
// @match        https://*.hilokal.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    console.log('[TM] extractor loaded');

    const seen = new Set();
    const OriginalWebSocket = window.WebSocket;

    window.WebSocket = function (url, protocols) {
        const ws = protocols
            ? new OriginalWebSocket(url, protocols)
            : new OriginalWebSocket(url);

        ws.addEventListener('message', (event) => {
            if (typeof event.data !== 'string') return;
            if (!event.data.startsWith('42')) return;

            try {
                const [eventName, payload] = JSON.parse(event.data.slice(2));
                if (eventName !== 'group-call-card') return;
                extract(payload);
            } catch (_) {}
        });

        return ws;
    };

    function extract(obj) {
        if (!obj || typeof obj !== 'object') return;

        if (obj.name && obj.accessCityName) {
            const key = obj.name + obj.accessCityName;
            if (!seen.has(key)) {
                seen.add(key);
                console.warn(
                    '👤', obj.name,
                    '| 🌍', obj.accessCityName
                );
            }
        }

        for (const k in obj) {
            if (typeof obj[k] === 'object') extract(obj[k]);
        }
    }
})();
