let _downloadPort = null;

function _getDownloadServer()
{
    if(_downloadPort != null)
        return _downloadPort;

    _downloadPort = new Promise((accept, reject) => {
        let e = new Event("request-download-channel", { cancelable: true });
        if(window.dispatchEvent(e))
        {
            reject("GM.xmlHttpRequest isn't available");
            return;
        }

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

function _downloadUsingServer(serverPort, { url, ...args })
{
    return new Promise((accept, reject) => {
        if(url == null)
        {
            reject(null);
            return;
        }

        let { port1, port2 } = new MessageChannel();

        port2.onmessage = (e) => {
            port2.close();

            if(e.data.success)
                accept(e.data.response);
            else
                reject(new Error(e.data.error));
        };

        serverPort.realPostMessage({
            url,
            ...args,
        }, [port1]);
    });
}

async function _downloadViaRealFetch(url)
{
    if(!window.realFetch)
        throw new Error("realFetch unavailable");

    const r = await window.realFetch(url, {
        method: "GET",
        credentials: "include",
        referrer: "https://www.pixiv.net/",
        cache: "force-cache",
    });

    if(!r.ok)
        throw new Error(`HTTP ${r.status}`);

    return await r.arrayBuffer();
}

export async function downloadPixivImage(url)
{
    try {
        return await _downloadViaRealFetch(url);
    } catch(e) {
        console.warn(`realFetch failed for ${url}, falling back to GM.xmlHttpRequest:`, e);
    }

    let server = await _getDownloadServer();
    if(server == null)
        throw new Error("Downloading not available");

    return await _downloadUsingServer(server, {
        url,
        responseType: "arraybuffer",
        headers: {
            Referer: "https://www.pixiv.net/",
        },
    });
}

export async function sendRequest(args)
{
    let server = await _getDownloadServer();
    if(server == null)
        throw new Error("Downloading not available");

    return await _downloadUsingServer(server, args);
}