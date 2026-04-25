// If we're running as a user script, we may have access to GM.xmlHttpRequest.  This is
// sandboxed and exposed using a download port.  The server side of this is inside
// bootstrap.js.
let _downloadPort = null;

// Return a promise which resolves to the download MessagePort.
function _getDownloadServer()
{
    // If we already have a download port, return it.
    if(_downloadPort != null)
        return _downloadPort;

    _downloadPort = new Promise((accept, reject) => {
        // Send request-download-channel to window to ask the user script to send us the
        // GM.xmlHttpRequest message port.  If this is handled and we can expect a response,
        // the event will be cancelled.
        let e = new Event("request-download-channel", { cancelable: true });
        if(window.dispatchEvent(e))
        {
            reject("GM.xmlHttpRequest isn't available");
            return;
        }

        // The MessagePort will be returned as a message posted to the window.
        let receiveMessagePort = (e) => {
            if(e.data.cmd != "download-setup")
                return;

            window.removeEventListener("message", receiveMessagePort);
            _downloadPort = e.ports[0];
            accept(e.ports[0]);
        };

        window.addEventListener("message", receiveMessagePort);
    });
    return _downloadPort;
}

// Download url, returning the data.
//
// This is only used to download Pixiv images to save to disk.  Pixiv doesn't have CORS
// set up to give itself access to its own images, so we have to use GM.xmlHttpRequest to
// do this.
function _downloadUsingServer(serverPort, { url, ...args })
{
    return new Promise((accept, reject) => {
        if(url == null)
        {
            reject(null);
            return;
        }

        url = new URL(url);

        // Send a message to the sandbox to retrieve the image with GM.xmlHttpRequest, giving
        // it a message port to send the result back on.
        let { port1: serverResponsePort, port2: clientResponsePort } = new MessageChannel();
        clientResponsePort.onmessage = (e) => {
            clientResponsePort.close();

            if(e.data.success)
                accept(e.data.response);
            else
                reject(new Error(e.data.error));
        };

        serverPort.realPostMessage({
            url: url.toString(),
            ...args,
        }, [serverResponsePort]);
    });
}

// Canvas-based image download fallback for Safari/Userscripts where GM.xmlHttpRequest
// strips auth headers causing pximg to return 403.
// Uses the browser's native image loading which includes cookies and auth.
function _downloadViaCanvas(url)
{
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                canvas.toBlob(blob => {
                    blob.arrayBuffer().then(resolve).catch(reject);
                }, 'image/jpeg', 0.95);
            } catch(e) {
                reject(new Error('Canvas error: ' + e.message));
            }
        };
        img.onerror = () => {
            // crossOrigin anonymous failed — try without it
            // (image may already be cached by the browser without CORS headers)
            const img2 = new Image();
            img2.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = img2.naturalWidth;
                    canvas.height = img2.naturalHeight;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img2, 0, 0);
                    canvas.toBlob(blob => {
                        blob.arrayBuffer().then(resolve).catch(reject);
                    }, 'image/jpeg', 0.95);
                } catch(e) {
                    reject(new Error('Canvas tainted: ' + e.message));
                }
            };
            img2.onerror = () => reject(new Error('Image load failed'));
            img2.src = url;
        };
        img.src = url;
    });
}

// Download a Pixiv image using a GM.xmlHttpRequest server port retrieved
// with _getDownloadServer.
//
// On Safari/Userscripts, GM.xmlHttpRequest strips Referer/Origin headers causing
// pximg to return 403.  In that case, fall back to canvas-based download which
// uses the browser's native image loading with cookies and auth.
export async function downloadPixivImage(url)
{
    let server = await _getDownloadServer();
    if(server == null)
        throw new Error("Downloading not available");

    try {
        return await _downloadUsingServer(server, {
            url,
            headers: {
                "Cache-Control": "max-age=360000",
                Referer: "https://www.pixiv.net/",
                Origin: "https://www.pixiv.net/",
            },
        });
    } catch(e) {
        // If GM.xmlHttpRequest returned 403 (Safari strips auth headers),
        // fall back to canvas-based download
        if(e.message === 'HTTP 403') {
            console.log(`[ppixiv-safari] GM.xmlHttpRequest 403, trying canvas fallback for ${url}`);
            return await _downloadViaCanvas(url);
        }
        throw e;
    }
}

// Make a direct request to the download server.
export async function sendRequest(args)
{
    let server = await _getDownloadServer();
    if(server == null)
        throw new Error("Downloading not available");

    return await _downloadUsingServer(server, args);
}