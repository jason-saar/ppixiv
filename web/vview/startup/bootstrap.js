// This is the entry point when running as a user script.  bundle is the packaged
// app bundle.  We'll run the app bundle in the page context.
//
// When running natively for vview, app-startup.js is launched directly and this isn't used.
async function Bootstrap({
    bundle
} = {}) {
    // If this is an iframe, don't do anything, so we don't try to load in Pixiv iframes.
    if (window.top != window.self)
        return;

    // Don't activate for things like sketch.pixiv.net.
    if (window.location.hostname.endsWith(".pixiv.net") && window.location.hostname != "www.pixiv.net")
        return;

    // Some script managers define this on window, some as a local, and some not at all.
    let info = typeof GM_info != "undefined" ? GM_info : null;

    console.log(`ppixiv is running in ${info?.scriptHandler} ${info?.version}`);

    // If we're running in a user script and we have access to GM.xmlHttpRequest, give access to
    // it to support saving image files to disk.  Since we may be sandboxed, we do this through
    // a MessagePort.  We have to send this to the page, since the page has no way to send messages
    // to us on its own.
    //
    // helpers.cleanup_environment disables postMessage.  If we're not sandboxed, we'll be affected
    // by this too, so save a copy of postMessage in the same way that it does.
    window.MessagePort.prototype.xhrServerPostMessage = window.MessagePort.prototype.postMessage;

    function createXhrHandler() {
        console.log('[safari-fix] createXhrHandler called');
        let {
            port1: clientPort,
            port2: serverPort
        } = new MessageChannel();
        window.postMessage({
            cmd: "download-setup"
        }, "*", [clientPort]);

        serverPort.onmessage = async (e) => {
            console.log('[safari-fix] serverPort.onmessage fired, url:', e.data?.url, 'hasFormData:', !!e.data?.formData);
            
            if(!e.data?.url?.includes('cotrans.touhou.ai')) {
                console.log('[safari-fix] ignoring non-Cotrans request');
                return;
            }
            
            let responsePort = e.ports[0];
            let {
                url,
                method = "GET",
                formData,
                responseType = "arraybuffer",
                headers = null,
            } = e.data;

            let data = null;
            let extraHeaders = {};
            const isCotrans = url?.includes('cotrans.touhou.ai');

            if (formData && isCotrans) {
                // Safari/Userscripts fix: serialize FormData manually for Cotrans
                console.log('[safari-fix] GM available:', typeof GM !== 'undefined', 'handler:', GM?.info?.scriptHandler);
                const isUserscriptsSafari = typeof GM !== 'undefined' &&
                    GM.info?.scriptHandler === 'Userscripts';
                console.log('[safari-fix] isUserscriptsSafari:', isUserscriptsSafari);
                if (isUserscriptsSafari) {
                    const boundary = '----ppixivFormData' + Math.random().toString(36).slice(2);
                    const enc = new TextEncoder();
                    const parts = [];
                    for (let [key, value] of Object.entries(formData)) {
                        let header = `--${boundary}\r\nContent-Disposition: form-data; name="${key}"`;
                        if (value.toString() === '[object ArrayBuffer]' || value instanceof Blob) {
                            const bytes = value instanceof Blob ?
                                new Uint8Array(await value.arrayBuffer()) :
                                new Uint8Array(value);
                            const mime = value instanceof Blob ?
                                (value.type || 'application/octet-stream') :
                                'application/octet-stream';
                            header += `; filename="blob"\r\nContent-Type: ${mime}\r\n\r\n`;
                            parts.push(enc.encode(header), bytes, enc.encode('\r\n'));
                        } else {
                            header += `\r\n\r\n${value}\r\n`;
                            parts.push(enc.encode(header));
                        }
                    }
                    parts.push(enc.encode(`--${boundary}--\r\n`));
                    const total = parts.reduce((s, p) => s + p.byteLength, 0);
                    const body = new Uint8Array(total);
                    let offset = 0;
                    for (const part of parts) {
                        body.set(part, offset);
                        offset += part.byteLength;
                    }
                    data = body.buffer;
                    extraHeaders['Content-Type'] = `multipart/form-data; boundary=${boundary}`;
                } else {
                    data = new FormData();
                    for (let [key, value] of Object.entries(formData)) {
                        if (value.toString() == "[object ArrayBuffer]")
                            value = new Blob([value]);
                        data.append(key, value, 'blob');;
                    }
                }
            } else if (formData) {
                // Non-Cotrans FormData — use original approach
                data = new FormData();
                for (let [key, value] of Object.entries(formData)) {
                    if (value.toString() == "[object ArrayBuffer]")
                        value = new Blob([value]);
                    data.append(key, value, 'blob');;
                }
            }

            url = new URL(url);
            let allowedHosts = ["i.pximg.net", "i-cf.pximg.net", "cotrans.touhou.ai"];
            let anyMatches = false;
            for (let host of allowedHosts)
                if (url.hostname.endsWith(host))
                    anyMatches = true;

            if (!anyMatches) {
                responsePort.xhrServerPostMessage({
                    success: false,
                    error: `Unexpected ppdownload URL: ${url}`
                });
                return;
            }

            const xhrOptions = {
                method,
                headers: {
                    ...(headers || {}),
                    ...extraHeaders
                },
                responseType: responseType || 'arraybuffer',
                url: url.toString(),
                withCredentials: true,
                onload: (result) => {
                    console.log('[safari-fix] GM.xmlHttpRequest onload, status:', result.status, 'url:', url.toString());
                    let success = result.status < 400;
                    let error = `HTTP ${result.status}`;
                    let {
                        response
                    } = result;
                    let transfer = [];
                    if (response instanceof ArrayBuffer)
                        transfer.push(response);
                    responsePort.xhrServerPostMessage({
                        success,
                        error,
                        response
                    }, transfer);
                },
                onerror: (e) => {
                    console.error('[safari-fix] GM.xmlHttpRequest onerror:', e);
                    responsePort.xhrServerPostMessage({
                        success: false,
                        error: "Request error"
                    });
                },
            };
            if (data != null) xhrOptions.data = data;
            GM.xmlHttpRequest(xhrOptions);
        };

    } // closes createXhrHandler

    // Listen to requests from helpers._get_xhr_server.
    window.addEventListener("request-download-channel", (e) => {
        console.log('[safari-fix] request-download-channel fired');
        // e.preventDefault();
        createXhrHandler();
    });

    function runScript(source) {
        let script = document.createElement("script");
        script.textContent = source;
        document.documentElement.appendChild(script);
        script.remove();
    }

    runScript(bundle);
}

// This script is executed by eval(), so this expression is its return value.
Bootstrap;