'use strict';

/* =========================================
   FUTURES SIGNAL SCANNER V2
   AŞAMA 3 — BINANCE FUTURES CANLI VERİ
========================================= */

const appState = {
    currentView: 'markets',
    scanning: false,
    connected: false,
    marketCount: 0,
    longCount: 0,
    shortCount: 0,
    symbols: [],
    tickers: new Map(),
    lastStatus: 'Sistem başlatıldı.'
};

const BINANCE_API = 'https://fapi.binance.com';

/* ---------- Yardımcılar ---------- */

function $(id) {
    return document.getElementById(id);
}

function setStatus(message) {
    appState.lastStatus = message;

    const statusBox = $('statusBox');

    if (statusBox) {
        statusBox.textContent = message;
    }

    console.log('[Scanner]', message);
}

function setConnection(status, text) {
    const dot = $('connectionDot');
    const connectionText = $('connectionText');

    if (dot) {
        dot.classList.remove('online', 'offline', 'loading');

        if (status === 'online') {
            dot.classList.add('online');
        } else if (status === 'loading') {
            dot.classList.add('loading');
        } else {
            dot.classList.add('offline');
        }
    }

    if (connectionText) {
        connectionText.textContent = text;
    }

    appState.connected = status === 'online';
}

/* ---------- İstatistikler ---------- */

function renderStats() {
    const marketCount = $('marketCount');
    const longCount = $('longCount');
    const shortCount = $('shortCount');

    if (marketCount) {
        marketCount.textContent = appState.marketCount;
    }

    if (longCount) {
        longCount.textContent = appState.longCount;
    }

    if (shortCount) {
        shortCount.textContent = appState.shortCount;
    }
}

/* ---------- Görünüm yönetimi ---------- */

function showView(viewName) {
    const views = {
        markets: $('viewMarkets'),
        trade: $('viewTrade'),
        position: $('viewPosition'),
        settings: $('viewSettings')
    };

    Object.keys(views).forEach(key => {
        const view = views[key];

        if (view) {
            view.classList.toggle('active', key === viewName);
        }
    });

    document.querySelectorAll('.nav-btn').forEach(button => {
        button.classList.toggle(
            'active',
            button.dataset.view === viewName
        );
    });

    appState.currentView = viewName;
}

/* ---------- Piyasa listesini oluştur ---------- */

function renderMarketList() {
    const list = $('signalsList');
    const empty = $('signalsEmpty');

    if (!list) {
        return;
    }

    list.innerHTML = '';

    const tickerArray = Array.from(appState.tickers.values())
        .sort((a, b) => {
            return Math.abs(b.priceChangePercent) -
                   Math.abs(a.priceChangePercent);
        })
        .slice(0, 30);

    if (tickerArray.length === 0) {
        if (empty) {
            empty.style.display = 'block';
            empty.textContent = 'Henüz piyasa verisi alınmadı.';
        }

        return;
    }

    if (empty) {
        empty.style.display = 'none';
    }

    tickerArray.forEach(ticker => {
        const card = document.createElement('div');
        card.className = 'signal-card';

        const changeClass =
            ticker.priceChangePercent >= 0 ? 'positive' : 'negative';

        const changeSign =
            ticker.priceChangePercent >= 0 ? '+' : '';

        const formattedPrice = formatPrice(ticker.lastPrice);

        card.innerHTML = `
            <div class="signal-main">
                <div>
                    <div class="signal-symbol">${ticker.symbol}</div>
                    <div class="signal-meta">24 saatlik piyasa verisi</div>
                </div>

                <div class="signal-side">
                    <div class="signal-price">${formattedPrice}</div>
                    <div class="signal-change ${changeClass}">
                        ${changeSign}${ticker.priceChangePercent.toFixed(2)}%
                    </div>
                </div>
            </div>

            <div class="signal-footer">
                <span>Hacim: ${formatVolume(ticker.quoteVolume)}</span>
                <span>Canlı veri</span>
            </div>
        `;

        list.appendChild(card);
    });
}

/* ---------- Sayısal biçimlendirme ---------- */

function formatPrice(value) {
    const price = Number(value);

    if (!Number.isFinite(price)) {
        return '-';
    }

    if (price >= 1000) {
        return price.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    if (price >= 1) {
        return price.toLocaleString('en-US', {
            minimumFractionDigits: 4,
            maximumFractionDigits: 4
        });
    }

    if (price >= 0.01) {
        return price.toLocaleString('en-US', {
            minimumFractionDigits: 5,
            maximumFractionDigits: 5
        });
    }

    return price.toLocaleString('en-US', {
        minimumFractionDigits: 8,
        maximumFractionDigits: 8
    });
}

function formatVolume(value) {
    const volume = Number(value);

    if (!Number.isFinite(volume)) {
        return '-';
    }

    if (volume >= 1000000000) {
        return (volume / 1000000000).toFixed(2) + 'B USDT';
    }

    if (volume >= 1000000) {
        return (volume / 1000000).toFixed(2) + 'M USDT';
    }

    if (volume >= 1000) {
        return (volume / 1000).toFixed(2) + 'K USDT';
    }

    return volume.toFixed(2) + ' USDT';
}

/* ---------- Binance sembollerini al ---------- */

async function loadExchangeInfo() {
    const response = await fetch(
        `${BINANCE_API}/fapi/v1/exchangeInfo`
    );

    if (!response.ok) {
        throw new Error('Binance exchangeInfo bağlantısı başarısız.');
    }

    const data = await response.json();

    appState.symbols = data.symbols
        .filter(symbolInfo => {
            return (
                symbolInfo.status === 'TRADING' &&
                symbolInfo.quoteAsset === 'USDT' &&
                symbolInfo.contractType === 'PERPETUAL'
            );
        })
        .map(symbolInfo => symbolInfo.symbol);

    appState.marketCount = appState.symbols.length;

    renderStats();

    setStatus(
        `${appState.marketCount} adet USDT perpetual sözleşmesi bulundu.`
    );
}

/* ---------- Binance 24 saatlik ticker verisi ---------- */

async function loadTickers() {
    const response = await fetch(
        `${BINANCE_API}/fapi/v1/ticker/24hr`
    );

    if (!response.ok) {
        throw new Error('Binance ticker bağlantısı başarısız.');
    }

    const data = await response.json();

    const validSymbols = new Set(appState.symbols);

    data.forEach(item => {
        if (!validSymbols.has(item.symbol)) {
            return;
        }

        appState.tickers.set(item.symbol, {
            symbol: item.symbol,
            lastPrice: Number(item.lastPrice),
            priceChangePercent: Number(item.priceChangePercent),
            quoteVolume: Number(item.quoteVolume)
        });
    });

    renderMarketList();

    setStatus(
        `${appState.tickers.size} piyasanın canlı fiyat verisi alındı.`
    );
}

/* ---------- Binance WebSocket canlı fiyat akışı ---------- */

function connectWebSocket() {
    const socketUrl =
        'wss://fstream.binance.com/stream?streams=!ticker@arr';

    const ws = new WebSocket(socketUrl);

    setConnection('loading', 'Canlı bağlantı kuruluyor...');

    ws.onopen = () => {
        setConnection('online', 'Binance canlı bağlı');
        setStatus('Binance Futures WebSocket bağlantısı kuruldu.');
    };

    ws.onmessage = event => {
        try {
            const message = JSON.parse(event.data);
            const tickerList = message.data;

            if (!Array.isArray(tickerList)) {
                return;
            }

            const validSymbols = new Set(appState.symbols);

            tickerList.forEach(item => {
                if (!validSymbols.has(item.s)) {
                    return;
                }

                appState.tickers.set(item.s, {
                    symbol: item.s,
                    lastPrice: Number(item.c),
                    priceChangePercent: Number(item.P),
                    quoteVolume: Number(item.q)
                });
            });

            renderMarketList();
        } catch (error) {
            console.error('WebSocket veri hatası:', error);
        }
    };

    ws.onerror = error => {
        console.error('Binance WebSocket hatası:', error);
        setConnection('offline', 'Bağlantı hatası');
        setStatus('Canlı bağlantıda hata oluştu.');
    };

    ws.onclose = () => {
        setConnection('offline', 'Bağlantı kapandı');
        setStatus('Binance bağlantısı kapandı. Yeniden deneniyor...');

        setTimeout(() => {
            connectWebSocket();
        }, 5000);
    };
}

/* ---------- Tarama ---------- */

async function runLiveScan() {
    if (appState.scanning) {
        return;
    }

    appState.scanning = true;

    const scanButton = $('scanButton');

    if (scanButton) {
        scanButton.disabled = true;
        scanButton.textContent = 'Bağlanıyor...';
    }

    try {
        setConnection('loading', 'Binance verisi alınıyor...');
        setStatus('Binance Futures piyasaları yükleniyor...');

        await loadExchangeInfo();
        await loadTickers();

        connectWebSocket();

        setStatus(
            `Canlı bağlantı hazır. ${appState.marketCount} piyasa izleniyor.`
        );
    } catch (error) {
        console.error(error);

        setConnection('offline', 'Bağlantı başarısız');
        setStatus(
            'Binance verisi alınamadı. Birkaç saniye sonra tekrar deneyin.'
        );
    } finally {
        appState.scanning = false;

        if (scanButton) {
            scanButton.disabled = false;
            scanButton.textContent = 'Piyasaları Tara';
        }
    }
}

/* ---------- Temizle ---------- */

function clearApp() {
    appState.tickers.clear();
    appState.marketCount = 0;
    appState.longCount = 0;
    appState.shortCount = 0;

    renderStats();

    const list = $('signalsList');
    const empty = $('signalsEmpty');

    if (list) {
        list.innerHTML = '';
    }

    if (empty) {
        empty.style.display = 'block';
        empty.textContent = 'Henüz sinyal bulunmuyor.';
    }

    setConnection('offline', 'Bağlantı yok');
    setStatus('Ekran temizlendi.');
}

/* ---------- Navigasyon ---------- */

function bindNavigation() {
    document.querySelectorAll('.nav-btn').forEach(button => {
        button.addEventListener('click', () => {
            showView(button.dataset.view);
        });
    });
}

/* ---------- Butonlar ---------- */

function bindActions() {
    const scanButton = $('scanButton');
    const clearButton = $('clearButton');

    if (scanButton) {
        scanButton.addEventListener('click', runLiveScan);
    }

    if (clearButton) {
        clearButton.addEventListener('click', clearApp);
    }
}

/* ---------- Başlat ---------- */

function initApp() {
    renderStats();
    showView('markets');
    bindNavigation();
    bindActions();

    setConnection('offline', 'Hazır');
    setStatus('Binance bağlantısı için "Piyasaları Tara" butonuna basın.');

    console.log('Futures Signal Scanner V2 — Aşama 3 hazır.');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

