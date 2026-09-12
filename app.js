'use strict';

/* =========================================
   FUTURES SIGNAL SCANNER V2
   AŞAMA 4 — TEKNİK ANALİZ VE SİNYAL
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
    signals: [],
    selectedSignal: null,
    ws: null,
    lastStatus: 'Sistem başlatıldı.'
    paperBalance: 1000,
    paperOpenPosition: null,
    paperHistory: [],
    paperPlanSignal: null,
  
 
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
        return (volume / 1000000000).toFixed(2) + 'B';
    }

    if (volume >= 1000000) {
        return (volume / 1000000).toFixed(2) + 'M';
    }

    if (volume >= 1000) {
        return (volume / 1000).toFixed(2) + 'K';
    }

    return volume.toFixed(2);
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
        if (views[key]) {
            views[key].classList.toggle(
                'active',
                key === viewName
            );
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

/* =========================================
   BINANCE VERİLERİ
========================================= */

async function binanceFetch(path) {
    const response = await fetch(`${BINANCE_API}${path}`);

    if (!response.ok) {
        throw new Error(`Binance API hatası: ${response.status}`);
    }

    return response.json();
}

async function loadExchangeInfo() {
    const data = await binanceFetch('/fapi/v1/exchangeInfo');

    appState.symbols = data.symbols
        .filter(item => {
            return (
                item.status === 'TRADING' &&
                item.quoteAsset === 'USDT' &&
                item.contractType === 'PERPETUAL'
            );
        })
        .map(item => item.symbol);

    appState.marketCount = appState.symbols.length;
    renderStats();
}

async function loadTickers() {
    const data = await binanceFetch('/fapi/v1/ticker/24hr');

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
}

async function getKlines(symbol, interval, limit = 120) {
    const encodedSymbol = encodeURIComponent(symbol);

    const data = await binanceFetch(
        `/fapi/v1/klines?symbol=${encodedSymbol}&interval=${interval}&limit=${limit}`
    );

    return data.map(candle => {
        return {
            openTime: candle[0],
            open: Number(candle[1]),
            high: Number(candle[2]),
            low: Number(candle[3]),
            close: Number(candle[4]),
            volume: Number(candle[5]),
            closeTime: candle[6]
        };
    });
}

/* =========================================
   TEKNİK GÖSTERGELER
========================================= */

function calculateEMA(values, period) {
    if (!values || values.length < period) {
        return null;
    }

    const multiplier = 2 / (period + 1);

    let ema = values
        .slice(0, period)
        .reduce((sum, value) => sum + value, 0) / period;

    for (let i = period; i < values.length; i++) {
        ema = (
            (values[i] - ema) * multiplier
        ) + ema;
    }

    return ema;
}

function calculateRSI(values, period = 14) {
    if (!values || values.length < period + 1) {
        return 50;
    }

    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
        const difference = values[i] - values[i - 1];

        if (difference >= 0) {
            gains += difference;
        } else {
            losses += Math.abs(difference);
        }
    }

    let averageGain = gains / period;
    let averageLoss = losses / period;

    for (let i = period + 1; i < values.length; i++) {
        const difference = values[i] - values[i - 1];
        const gain = difference > 0 ? difference : 0;
        const loss = difference < 0 ? Math.abs(difference) : 0;

        averageGain = (
            (averageGain * (period - 1)) + gain
        ) / period;

        averageLoss = (
            (averageLoss * (period - 1)) + loss
        ) / period;
    }

    if (averageLoss === 0) {
        return 100;
    }

    const relativeStrength = averageGain / averageLoss;

    return 100 - (100 / (1 + relativeStrength));
}

function calculateMACD(values) {
    if (!values || values.length < 35) {
        return {
            macd: 0,
            signal: 0,
            histogram: 0
        };
    }

    const macdValues = [];

    for (let i = 0; i < values.length; i++) {
        const slice = values.slice(0, i + 1);

        if (slice.length < 26) {
            continue;
        }

        const ema12 = calculateEMA(slice, 12);
        const ema26 = calculateEMA(slice, 26);

        if (ema12 !== null && ema26 !== null) {
            macdValues.push(ema12 - ema26);
        }
    }

    if (macdValues.length < 9) {
        return {
            macd: 0,
            signal: 0,
            histogram: 0
        };
    }

    const macd = macdValues[macdValues.length - 1];
    const signal = calculateEMA(macdValues, 9) || 0;

    return {
        macd,
        signal,
        histogram: macd - signal
    };
}

function calculateATR(candles, period = 14) {
    if (!candles || candles.length < period + 1) {
        return 0;
    }

    const trueRanges = [];

    for (let i = 1; i < candles.length; i++) {
        const current = candles[i];
        const previous = candles[i - 1];

        const trueRange = Math.max(
            current.high - current.low,
            Math.abs(current.high - previous.close),
            Math.abs(current.low - previous.close)
        );

        trueRanges.push(trueRange);
    }

    const recentRanges = trueRanges.slice(-period);

    return recentRanges.reduce(
        (sum, value) => sum + value,
        0
    ) / recentRanges.length;
}

function calculateVolumeRatio(candles, period = 20) {
    if (!candles || candles.length < period + 1) {
        return 1;
    }

    const currentVolume = candles[candles.length - 1].volume;

    const previousVolumes = candles
        .slice(-(period + 1), -1)
        .map(candle => candle.volume);

    const averageVolume = previousVolumes.reduce(
        (sum, value) => sum + value,
        0
    ) / previousVolumes.length;

    if (averageVolume === 0) {
        return 1;
    }

    return currentVolume / averageVolume;
}

function getTrend(candles) {
    const closes = candles.map(candle => candle.close);
    const lastPrice = closes[closes.length - 1];

    const ema20 = calculateEMA(closes, 20);
    const ema50 = calculateEMA(closes, 50);
    const ema100 = calculateEMA(closes, 100);

    if (!ema20 || !ema50 || !ema100) {
        return 'NEUTRAL';
    }

    if (
        lastPrice > ema20 &&
        ema20 > ema50 &&
        ema50 > ema100
    ) {
        return 'LONG';
    }

    if (
        lastPrice < ema20 &&
        ema20 < ema50 &&
        ema50 < ema100
    ) {
        return 'SHORT';
    }

    if (lastPrice > ema20 && ema20 > ema50) {
        return 'LONG_WEAK';
    }

    if (lastPrice < ema20 && ema20 < ema50) {
        return 'SHORT_WEAK';
    }

    return 'NEUTRAL';
}

/* =========================================
   COİN ANALİZİ
========================================= */

async function analyzeSymbol(symbol) {
    try {
        const [candles5m, candles15m, candles1h] = await Promise.all([
            getKlines(symbol, '5m', 120),
            getKlines(symbol, '15m', 120),
            getKlines(symbol, '1h', 120)
        ]);

        if (
            candles5m.length < 50 ||
            candles15m.length < 50 ||
            candles1h.length < 50
        ) {
            return null;
        }

        const closes5m = candles5m.map(candle => candle.close);
        const closes15m = candles15m.map(candle => candle.close);
        const closes1h = candles1h.map(candle => candle.close);

        const price = closes5m[closes5m.length - 1];

        const trend5m = getTrend(candles5m);
        const trend15m = getTrend(candles15m);
        const trend1h = getTrend(candles1h);

        const rsi5m = calculateRSI(closes5m);
        const rsi15m = calculateRSI(closes15m);
        const rsi1h = calculateRSI(closes1h);

        const macd5m = calculateMACD(closes5m);
        const macd15m = calculateMACD(closes15m);
        const macd1h = calculateMACD(closes1h);

        const atr = calculateATR(candles5m);
        const atrPercent = price > 0 ? (atr / price) * 100 : 0;

        const volumeRatio = calculateVolumeRatio(candles5m);

        let longPoints = 0;
        let shortPoints = 0;

        /* ---------- Trend puanları ---------- */

        if (trend1h === 'LONG') {
            longPoints += 3;
        } else if (trend1h === 'LONG_WEAK') {
            longPoints += 1;
        } else if (trend1h === 'SHORT') {
            shortPoints += 3;
        } else if (trend1h === 'SHORT_WEAK') {
            shortPoints += 1;
        }

        if (trend15m === 'LONG') {
            longPoints += 2;
        } else if (trend15m === 'LONG_WEAK') {
            longPoints += 1;
        } else if (trend15m === 'SHORT') {
            shortPoints += 2;
        } else if (trend15m === 'SHORT_WEAK') {
            shortPoints += 1;
        }

        if (trend5m === 'LONG') {
            longPoints += 2;
        } else if (trend5m === 'LONG_WEAK') {
            longPoints += 1;
        } else if (trend5m === 'SHORT') {
            shortPoints += 2;
        } else if (trend5m === 'SHORT_WEAK') {
            shortPoints += 1;
        }

        /* ---------- RSI puanları ---------- */

        if (rsi1h >= 52 && rsi1h <= 70) {
            longPoints += 2;
        }

        if (rsi1h <= 48 && rsi1h >= 30) {
            shortPoints += 2;
        }

        if (rsi15m >= 52 && rsi15m <= 72) {
            longPoints += 1;
        }

        if (rsi15m <= 48 && rsi15m >= 28) {
            shortPoints += 1;
        }

        if (rsi5m >= 52 && rsi5m <= 75) {
            longPoints += 1;
        }

        if (rsi5m <= 48 && rsi5m >= 25) {
            shortPoints += 1;
        }

        /* ---------- MACD puanları ---------- */

        if (macd1h.histogram > 0) {
            longPoints += 2;
        } else if (macd1h.histogram < 0) {
            shortPoints += 2;
        }

        if (macd15m.histogram > 0) {
            longPoints += 1;
        } else if (macd15m.histogram < 0) {
            shortPoints += 1;
        }

        if (macd5m.histogram > 0) {
            longPoints += 1;
        } else if (macd5m.histogram < 0) {
            shortPoints += 1;
        }

        /* ---------- Hacim puanı ---------- */

        if (volumeRatio >= 1.2) {
            if (longPoints > shortPoints) {
                longPoints += 1;
            } else if (shortPoints > longPoints) {
                shortPoints += 1;
            }
        }

        const totalPoints = longPoints + shortPoints;

        let score = 50;

        if (totalPoints > 0) {
            score = 50 + (
                (longPoints - shortPoints) / totalPoints
            ) * 50;
        }

        score = Math.max(0, Math.min(100, score));

        let side = 'NEUTRAL';

        if (score >= 62) {
            side = 'LONG';
        } else if (score <= 38) {
            side = 'SHORT';
        }

        let confirmation = 'İZLE';

        if (
            side === 'LONG' &&
            trend1h === 'LONG' &&
            trend15m === 'LONG'
        ) {
            confirmation = 'LONG TEYİT EDİLDİ';
        } else if (
            side === 'SHORT' &&
            trend1h === 'SHORT' &&
            trend15m === 'SHORT'
        ) {
            confirmation = 'SHORT TEYİT EDİLDİ';
        } else if (side !== 'NEUTRAL') {
            confirmation = 'TEYİT BEKLENİYOR';
        }

        const ticker = appState.tickers.get(symbol);

        return {
            symbol,
            price,
            side,
            score: Math.round(score),
            confirmation,
            change24h: ticker ? ticker.priceChangePercent : 0,
            quoteVolume: ticker ? ticker.quoteVolume : 0,
            rsi5m,
            rsi15m,
            rsi1h,
            volumeRatio,
            atrPercent,
            trend5m,
            trend15m,
            trend1h,
            macd5m: macd5m.histogram,
            macd15m: macd15m.histogram,
            macd1h: macd1h.histogram,
            longPoints,
            shortPoints
        };
    } catch (error) {
        console.warn(`${symbol} analiz edilemedi:`, error.message);
        return null;
    }
}

/* =========================================
   SİNYALLERİ GÖSTER
========================================= */

function renderSignals() {
    const list = $('signalsList');
    const empty = $('signalsEmpty');

    if (!list) {
        return;
    }

    list.innerHTML = '';

    const visibleSignals = appState.signals
        .filter(signal => signal.side !== 'NEUTRAL')
        .sort((a, b) => b.score - a.score)
        .slice(0, 30);

    appState.longCount = visibleSignals.filter(
        signal => signal.side === 'LONG'
    ).length;

    appState.shortCount = visibleSignals.filter(
        signal => signal.side === 'SHORT'
    ).length;

    renderStats();

    if (visibleSignals.length === 0) {
        if (empty) {
            empty.style.display = 'block';
            empty.textContent =
                'Henüz güçlü LONG veya SHORT sinyali bulunamadı.';
        }

        return;
    }

    if (empty) {
        empty.style.display = 'none';
    }

   visibleSignals.forEach(signal => {
    const card = document.createElement('div');

    const sideClass =
        signal.side === 'LONG' ? 'long' : 'short';

    const scoreClass =
        signal.score >= 75
            ? 'high'
            : signal.score >= 62
                ? 'medium'
                : 'low';

    const changeSign =
        signal.change24h >= 0 ? '+' : '';

    card.className = `signal-card ${sideClass}`;

    card.innerHTML = `
        <div class="signal-main">
            <div>
                <div class="signal-symbol">
                    ${signal.symbol}
                </div>

                <div class="signal-meta">
                    ${signal.confirmation}
                </div>
            </div>

            <div class="signal-side">
                <div class="signal-direction ${sideClass}">
                    ${signal.side}
                </div>

                <div class="signal-score ${scoreClass}">
                    ${signal.score}/100
                </div>
            </div>
        </div>

        <div class="signal-price-row">
            <strong>${formatPrice(signal.price)}</strong>

            <span class="${signal.change24h >= 0 ? 'positive' : 'negative'}">
                ${changeSign}${signal.change24h.toFixed(2)}%
            </span>
        </div>

        <div class="signal-details">
            <span>RSI 1H: ${signal.rsi1h.toFixed(1)}</span>
            <span>RSI 15M: ${signal.rsi15m.toFixed(1)}</span>
            <span>RSI 5M: ${signal.rsi5m.toFixed(1)}</span>
            <span>Hacim: ${signal.volumeRatio.toFixed(2)}x</span>
            <span>ATR: ${signal.atrPercent.toFixed(2)}%</span>
        </div>

        <div class="signal-trends">
            <span>5M: ${formatTrend(signal.trend5m)}</span>
            <span>15M: ${formatTrend(signal.trend15m)}</span>
            <span>1H: ${formatTrend(signal.trend1h)}</span>
        </div>

        <div class="signal-footer">
            <span>Hacim: ${formatVolume(signal.quoteVolume)} USDT</span>

            <button
                class="plan-btn"
                type="button"
                data-symbol="${signal.symbol}">
                İşlem planı
            </button>
        </div>
    `;

    list.appendChild(card);
});
   
}

function formatTrend(trend) {
    if (trend === 'LONG') {
        return '▲ LONG';
    }

    if (trend === 'SHORT') {
        return '▼ SHORT';
    }

    if (trend === 'LONG_WEAK') {
        return '↗ Zayıf Long';
    }

    if (trend === 'SHORT_WEAK') {
        return '↘ Zayıf Short';
    }

    return '— Nötr';
}

/* =========================================
   TARAMA
========================================= */

async function runLiveScan() {
    if (appState.scanning) {
        return;
    }

    appState.scanning = true;

    const scanButton = $('scanButton');

    if (scanButton) {
        scanButton.disabled = true;
        scanButton.textContent = 'Analiz ediliyor...';
    }

    try {
        setConnection('loading', 'Piyasalar yükleniyor...');
        setStatus('Binance Futures piyasaları alınıyor...');

        await loadExchangeInfo();
        await loadTickers();

        /*
          Önce 24 saatlik hacmi yüksek ilk 30 coin seçilir.
          Böylece tarama tarayıcıyı ve Binance API'sini yormaz.
        */
        const selectedSymbols = Array.from(
            appState.tickers.values()
        )
            .sort((a, b) => b.quoteVolume - a.quoteVolume)
            .slice(0, 30)
            .map(item => item.symbol);

        appState.signals = [];

        setConnection('online', 'Binance canlı bağlı');

        for (let i = 0; i < selectedSymbols.length; i++) {
            const symbol = selectedSymbols[i];

            setStatus(
                `Analiz ediliyor: ${symbol} (${i + 1}/${selectedSymbols.length})`
            );

            const result = await analyzeSymbol(symbol);

            if (result) {
                appState.signals.push(result);
            }
        }

        renderSignals();

        setStatus(
            `Tarama tamamlandı. ${appState.signals.length} coin analiz edildi.`
        );

        connectWebSocket();
    } catch (error) {
        console.error(error);

        setConnection('offline', 'Bağlantı başarısız');
        setStatus(
            'Binance verisi alınamadı. Sayfayı yenileyip tekrar deneyin.'
        );
    } finally {
        appState.scanning = false;

        if (scanButton) {
            scanButton.disabled = false;
            scanButton.textContent = 'Piyasaları Tara';
        }
    }
}

/* =========================================
   CANLI FİYAT WEBSOCKET
========================================= */

function connectWebSocket() {
    if (
        appState.ws &&
        (
            appState.ws.readyState === WebSocket.OPEN ||
            appState.ws.readyState === WebSocket.CONNECTING
        )
    ) {
        return;
    }

    try {
        const socketUrl =
            'wss://fstream.binance.com/stream?streams=!ticker@arr';

        const ws = new WebSocket(socketUrl);

        appState.ws = ws;

        ws.onopen = () => {
            setConnection('online', 'Binance canlı bağlı');
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
                       checkPaperPosition();

                appState.signals.forEach(signal => {
                    const ticker = appState.tickers.get(signal.symbol);

                    if (ticker) {
                        signal.price = ticker.lastPrice;
                        signal.change24h = ticker.priceChangePercent;
                        signal.quoteVolume = ticker.quoteVolume;
                    }
                });

                renderSignals();
            } catch (error) {
                console.warn('Canlı veri işlenemedi:', error);
            }
        };

        ws.onerror = error => {
            console.warn('WebSocket hatası:', error);
            setConnection('offline', 'Canlı bağlantı hatası');
        };

        ws.onclose = () => {
            appState.ws = null;
            setConnection('offline', 'Bağlantı kapandı');
        };
    } catch (error) {
        console.warn('WebSocket başlatılamadı:', error);
    }
}

/* =========================================
   TEMİZLE
========================================= */

function clearApp() {
    appState.tickers.clear();
    appState.signals = [];
    appState.marketCount = 0;
    appState.longCount = 0;
    appState.shortCount = 0;

    renderStats();
    renderSignals();

    const empty = $('signalsEmpty');

    if (empty) {
        empty.style.display = 'block';
        empty.textContent = 'Henüz sinyal bulunmuyor.';
    }

    setConnection('offline', 'Hazır');
    setStatus('Ekran temizlendi.');
}

/* =========================================
   NAVİGASYON VE BUTONLAR
========================================= */

function bindNavigation() {
    document.querySelectorAll('.nav-btn').forEach(button => {
        button.addEventListener('click', () => {
            showView(button.dataset.view);
        });
    });
}

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


/* =========================================
   AŞAMA 5 — İŞLEM PLANI
========================================= */

function calculateTradePlan(signal) {
    if (!signal || !signal.price) {
        return null;
    }

    const entry = Number(signal.price);

    /*
      ATR yüzdesini kullanarak volatiliteye göre
      risk mesafesi hesaplanır.
    */
    const atrRisk = entry * (signal.atrPercent / 100) * 1.5;

    /*
      ATR çok küçükse stop mesafesi aşırı dar olmasın.
    */
    const minimumRisk = entry * 0.004;

    const riskDistance = Math.max(
        atrRisk,
        minimumRisk
    );

    let stopLoss;
    let tp1;
    let tp2;
    let tp3;

    if (signal.side === 'LONG') {
        stopLoss = entry - riskDistance;
        tp1 = entry + riskDistance;
        tp2 = entry + riskDistance * 2;
        tp3 = entry + riskDistance * 3;
    } else {
        stopLoss = entry + riskDistance;
        tp1 = entry - riskDistance;
        tp2 = entry - riskDistance * 2;
        tp3 = entry - riskDistance * 3;
    }

    let leverage = '3x';

    if (signal.atrPercent <= 1.5) {
        leverage = '5x';
    } else if (signal.atrPercent > 3) {
        leverage = '2x';
    }

    return {
        symbol: signal.symbol,
        side: signal.side,
        score: signal.score,
        confirmation: signal.confirmation,
        entry,
        stopLoss,
        tp1,
        tp2,
        tp3,
        riskDistance,
        leverage,
        riskReward1: 1,
        riskReward2: 2,
        riskReward3: 3
    };
}

function showTradePlan(signal) {
    const panel = $('tradePlanPanel');
    const symbolBox = $('tradePlanSymbol');
    const content = $('tradePlanContent');

    if (!panel || !symbolBox || !content || !signal) {
        return;
    }

    const plan = calculateTradePlan(signal);

    if (!plan) {
        return;
    }

    appState.selectedSignal = signal;
    appState.paperPlanSignal = signal;

    symbolBox.textContent =
        `${plan.symbol} · ${plan.side} · ${plan.score}/100`;

    content.innerHTML = `
        <div class="trade-plan-grid">
            <div class="trade-plan-item">
                <div class="trade-plan-label">Yön</div>
                <div class="trade-plan-value info">
                    ${plan.side}
                </div>
            </div>

            <div class="trade-plan-item">
                <div class="trade-plan-label">Skor</div>
                <div class="trade-plan-value info">
                    ${plan.score}/100
                </div>
            </div>

            <div class="trade-plan-item">
                <div class="trade-plan-label">Giriş</div>
                <div class="trade-plan-value entry">
                    ${formatPrice(plan.entry)}
                </div>
            </div>

            <div class="trade-plan-item">
                <div class="trade-plan-label">Stop-Loss</div>
                <div class="trade-plan-value stop">
                    ${formatPrice(plan.stopLoss)}
                </div>
            </div>

            <div class="trade-plan-item">
                <div class="trade-plan-label">TP1 · 1R</div>
                <div class="trade-plan-value tp">
                    ${formatPrice(plan.tp1)}
                </div>
            </div>

            <div class="trade-plan-item">
                <div class="trade-plan-label">TP2 · 2R</div>
                <div class="trade-plan-value tp">
                    ${formatPrice(plan.tp2)}
                </div>
            </div>

            <div class="trade-plan-item">
                <div class="trade-plan-label">TP3 · 3R</div>
                <div class="trade-plan-value tp">
                    ${formatPrice(plan.tp3)}
                </div>
            </div>

            <div class="trade-plan-item">
                <div class="trade-plan-label">Önerilen kaldıraç</div>
                <div class="trade-plan-value info">
                    ${plan.leverage}
                </div>
            </div>
        </div>

        <div class="trade-plan-note">
            Teyit durumu: ${plan.confirmation}<br>
            Risk mesafesi: ${formatPrice(plan.riskDistance)}<br>
            Risk/Ödül: TP1 1:1 · TP2 1:2 · TP3 1:3
        </div>
    `;

    panel.style.display = 'block';

    panel.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
    });
}

function closeTradePlan() {
    const panel = $('tradePlanPanel');

    if (panel) {
        panel.style.display = 'none';
    }

    appState.selectedSignal = null;
}

function bindTradePlanActions() {
    const list = $('signalsList');
    const closeButton = $('closeTradePlan');
    const paperButton = $('paperTradeButton');

    if (list) {
        list.addEventListener('click', event => {
            const planButton = event.target.closest('.plan-btn');

            if (!planButton) {
                return;
            }

            const symbol = planButton.dataset.symbol;

            const signal = appState.signals.find(
                item => item.symbol === symbol
            );

            if (signal) {
                showTradePlan(signal);
            }
        });
    }

    if (closeButton) {
        closeButton.addEventListener('click', closeTradePlan);
    }

    if (paperButton) {
        paperButton.addEventListener('click', () => {
            alert(
                'Paper Trading bağlantısı bir sonraki adımda etkinleştirilecek.'
            );
        });
    }
}


/* =========================================
   AŞAMA 5B — PAPER TRADING
========================================= */

const PAPER_BALANCE_KEY = 'paperTradingBalance';
const PAPER_POSITION_KEY = 'paperTradingOpenPosition';
const PAPER_HISTORY_KEY = 'paperTradingHistory';

function loadPaperTradingState() {
    const savedBalance = localStorage.getItem(PAPER_BALANCE_KEY);
    const savedPosition = localStorage.getItem(PAPER_POSITION_KEY);
    const savedHistory = localStorage.getItem(PAPER_HISTORY_KEY);

    if (savedBalance !== null) {
        const parsedBalance = Number(savedBalance);

        if (Number.isFinite(parsedBalance)) {
            appState.paperBalance = parsedBalance;
        }
    }

    if (savedPosition) {
        try {
            appState.paperOpenPosition = JSON.parse(savedPosition);
        } catch (error) {
            appState.paperOpenPosition = null;
        }
    }

    if (savedHistory) {
        try {
            const parsedHistory = JSON.parse(savedHistory);

            if (Array.isArray(parsedHistory)) {
                appState.paperHistory = parsedHistory;
            }
        } catch (error) {
            appState.paperHistory = [];
        }
    }
}

function savePaperTradingState() {
    localStorage.setItem(
        PAPER_BALANCE_KEY,
        String(appState.paperBalance)
    );

    localStorage.setItem(
        PAPER_POSITION_KEY,
        JSON.stringify(appState.paperOpenPosition)
    );

    localStorage.setItem(
        PAPER_HISTORY_KEY,
        JSON.stringify(appState.paperHistory)
    );
}

function formatUsdt(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return '0.00 USDT';
    }

    return `${number.toLocaleString('tr-TR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    })} USDT`;
}

function formatPaperPrice(value) {
    if (typeof formatPrice === 'function') {
        return formatPrice(Number(value));
    }

    const number = Number(value);

    if (!Number.isFinite(number)) {
        return '-';
    }

    if (number >= 1000) {
        return number.toFixed(2);
    }

    if (number >= 1) {
        return number.toFixed(4);
    }

    if (number >= 0.01) {
        return number.toFixed(6);
    }

    return number.toFixed(8);
}

function calculatePaperPositionSize(signal, riskPercent, leverage) {
    if (!signal || !signal.price || !signal.atrPercent) {
        return null;
    }

    const entry = Number(signal.price);
    const balance = Number(appState.paperBalance);

    const riskAmount = balance * (riskPercent / 100);

    const atrRisk =
        entry * (Number(signal.atrPercent) / 100) * 1.5;

    const minimumRisk = entry * 0.004;

    const riskDistance = Math.max(
        atrRisk,
        minimumRisk
    );

    if (
        !Number.isFinite(entry) ||
        !Number.isFinite(balance) ||
        !Number.isFinite(riskAmount) ||
        !Number.isFinite(riskDistance) ||
        riskDistance <= 0
    ) {
        return null;
    }

    const quantity = riskAmount / riskDistance;
    const notional = quantity * entry;
    const margin = notional / leverage;

    return {
        entry,
        riskAmount,
        riskDistance,
        quantity,
        notional,
        margin,
        leverage
    };
}

function getPaperFormValues() {
    const riskInput = $('paperRiskPercent');
    const leverageInput = $('paperLeverage');

    const riskPercent = Number(
        riskInput ? riskInput.value : 1
    );

    const leverage = Number(
        leverageInput ? leverageInput.value : 3
    );

    return {
        riskPercent: Math.min(
            Math.max(riskPercent || 1, 0.1),
            10
        ),
        leverage: Math.min(
            Math.max(leverage || 3, 1),
            50
        )
    };
}

function renderPaperBalance() {
    const balanceElement = $('paperBalanceValue');

    if (balanceElement) {
        balanceElement.textContent =
            formatUsdt(appState.paperBalance);
    }
}

function renderPaperTradePreview() {
    const preview = $('paperTradePreview');
    const signal = appState.paperPlanSignal;

    if (!preview || !signal) {
        return;
    }

    const {
        riskPercent,
        leverage
    } = getPaperFormValues();

    const position = calculatePaperPositionSize(
        signal,
        riskPercent,
        leverage
    );

    if (!position) {
        preview.innerHTML = `
            <div class="paper-preview-title">
                Hesaplama yapılamadı
            </div>
            <div>Geçerli sinyal verisi bulunamadı.</div>
        `;

        return;
    }

    preview.innerHTML = `
        <div class="paper-preview-title">
            Sanal pozisyon ön izlemesi
        </div>

        <div class="paper-preview-row">
            <span class="paper-preview-label">Yön</span>
            <span class="paper-preview-value">
                ${signal.side}
            </span>
        </div>

        <div class="paper-preview-row">
            <span class="paper-preview-label">Giriş</span>
            <span class="paper-preview-value">
                ${formatPaperPrice(position.entry)}
            </span>
        </div>

        <div class="paper-preview-row">
            <span class="paper-preview-label">Risk miktarı</span>
            <span class="paper-preview-value">
                ${formatUsdt(position.riskAmount)}
            </span>
        </div>

        <div class="paper-preview-row">
            <span class="paper-preview-label">Pozisyon adedi</span>
            <span class="paper-preview-value">
                ${position.quantity.toFixed(4)}
            </span>
        </div>

        <div class="paper-preview-row">
            <span class="paper-preview-label">Pozisyon değeri</span>
            <span class="paper-preview-value">
                ${formatUsdt(position.notional)}
            </span>
        </div>

        <div class="paper-preview-row">
            <span class="paper-preview-label">Kullanılan teminat</span>
            <span class="paper-preview-value">
                ${formatUsdt(position.margin)}
            </span>
        </div>

        <div class="paper-preview-row">
            <span class="paper-preview-label">Kaldıraç</span>
            <span class="paper-preview-value">
                ${leverage}x
            </span>
        </div>

        <div class="paper-preview-row">
            <span class="paper-preview-label">Risk yüzdesi</span>
            <span class="paper-preview-value">
                %${riskPercent.toFixed(1)}
            </span>
        </div>
    `;
}

function showPaperTrading(signal) {
    const panel = $('paperTradingPanel');
    const symbolElement = $('paperSymbol');

    if (!panel || !symbolElement || !signal) {
        return;
    }

    if (appState.paperOpenPosition) {
        alert(
            'Önce mevcut sanal pozisyonu kapatmalısın.'
        );
        return;
    }

    appState.paperPlanSignal = signal;

    symbolElement.textContent =
        `${signal.symbol} · ${signal.side} · ${signal.score}/100`;

    renderPaperBalance();
    renderPaperTradePreview();

    panel.style.display = 'block';

    panel.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
    });
}

function closePaperTrading() {
    const panel = $('paperTradingPanel');

    if (panel) {
        panel.style.display = 'none';
    }

    appState.paperPlanSignal = null;
}

function openPaperPosition() {
    const signal = appState.paperPlanSignal;

    if (!signal) {
        alert('Önce bir işlem planı seçmelisin.');
        return;
    }

    if (appState.paperOpenPosition) {
        alert('Zaten açık bir sanal pozisyon var.');
        return;
    }

    const {
        riskPercent,
        leverage
    } = getPaperFormValues();

    const position = calculatePaperPositionSize(
        signal,
        riskPercent,
        leverage
    );

    if (!position) {
        alert('Pozisyon hesaplanamadı.');
        return;
    }

    const plan = calculateTradePlan(signal);

    if (!plan) {
        alert('İşlem planı oluşturulamadı.');
        return;
    }

    if (position.margin > appState.paperBalance) {
        alert(
            'Bu işlem için gereken teminat sanal bakiyeden fazla.'
        );
        return;
    }

    appState.paperOpenPosition = {
        id: Date.now(),
        symbol: signal.symbol,
        side: signal.side,
        score: signal.score,
        quantity: position.quantity,
        entry: position.entry,
        margin: position.margin,
        notional: position.notional,
        riskAmount: position.riskAmount,
        leverage: position.leverage,
        stopLoss: plan.stopLoss,
        tp1: plan.tp1,
        tp2: plan.tp2,
        tp3: plan.tp3,
        openedAt: new Date().toISOString()
    };

    savePaperTradingState();
    closePaperTrading();

    alert(
        `${signal.symbol} için ${signal.side} sanal pozisyon açıldı.`
    );

    renderPaperTradingSection();
}

function getLivePriceForPosition(position) {
    if (!position || !position.symbol) {
        return null;
    }

    const ticker = appState.tickers &&
        appState.tickers.get(position.symbol);

    if (ticker) {
        const possiblePrice =
            ticker.lastPrice ||
            ticker.price ||
            ticker.c;

        const price = Number(possiblePrice);

        if (Number.isFinite(price) && price > 0) {
            return price;
        }
    }

    const signal = appState.signals.find(
        item => item.symbol === position.symbol
    );

    if (signal && Number(signal.price) > 0) {
        return Number(signal.price);
    }

    return null;
}

function calculatePaperPnl(position, currentPrice) {
    if (!position || !currentPrice) {
        return {
            pnl: 0,
            pnlPercent: 0
        };
    }

    const priceDifference =
        position.side === 'LONG'
            ? currentPrice - position.entry
            : position.entry - currentPrice;

    const pnl = priceDifference * position.quantity;

    const pnlPercent =
        position.margin > 0
            ? (pnl / position.margin) * 100
            : 0;

    return {
        pnl,
        pnlPercent
    };
}

function getPaperCloseReason(position, currentPrice) {
    if (!position || !currentPrice) {
        return null;
    }

    if (position.side === 'LONG') {
        if (currentPrice <= position.stopLoss) {
            return 'Stop-Loss';
        }

        if (currentPrice >= position.tp3) {
            return 'TP3';
        }

        if (currentPrice >= position.tp2) {
            return 'TP2';
        }

        if (currentPrice >= position.tp1) {
            return 'TP1';
        }
    }

    if (position.side === 'SHORT') {
        if (currentPrice >= position.stopLoss) {
            return 'Stop-Loss';
        }

        if (currentPrice <= position.tp3) {
            return 'TP3';
        }

        if (currentPrice <= position.tp2) {
            return 'TP2';
        }

        if (currentPrice <= position.tp1) {
            return 'TP1';
        }
    }

    return null;
}

function closePaperPosition(reason, currentPrice) {
    const position = appState.paperOpenPosition;

    if (!position || !currentPrice) {
        return;
    }

    const {
        pnl,
        pnlPercent
    } = calculatePaperPnl(
        position,
        currentPrice
    );

    appState.paperBalance += pnl;

    const historyItem = {
        ...position,
        closePrice: currentPrice,
        pnl,
        pnlPercent,
        closeReason: reason,
        closedAt: new Date().toISOString()
    };

    appState.paperHistory.unshift(historyItem);

    if (appState.paperHistory.length > 50) {
        appState.paperHistory =
            appState.paperHistory.slice(0, 50);
    }

    appState.paperOpenPosition = null;

    savePaperTradingState();

    alert(
        `${position.symbol} pozisyonu kapandı.\n` +
        `Neden: ${reason}\n` +
        `Sonuç: ${formatUsdt(pnl)}`
    );

    renderPaperTradingSection();
}

function checkPaperPosition() {
    const position = appState.paperOpenPosition;

    if (!position) {
        return;
    }

    const currentPrice =
        getLivePriceForPosition(position);

    if (!currentPrice) {
        return;
    }

    const closeReason =
        getPaperCloseReason(position, currentPrice);

    if (closeReason) {
        closePaperPosition(
            closeReason,
            currentPrice
        );
    }

    renderPaperTradingSection();
}

function renderPaperTradingSection() {
    const container = $('paperTradingStatus');

    if (!container) {
        return;
    }

    renderPaperBalance();

    const position = appState.paperOpenPosition;

    let html = `
        <div class="paper-history">
            <div class="paper-history-title">
                Paper Trading
            </div>

            <div class="paper-balance-box">
                <div class="paper-balance-label">
                    Güncel sanal bakiye
                </div>

                <div class="paper-balance-value">
                    ${formatUsdt(appState.paperBalance)}
                </div>
            </div>
        </div>
    `;

    if (position) {
        const currentPrice =
            getLivePriceForPosition(position) ||
            position.entry;

        const {
            pnl,
            pnlPercent
        } = calculatePaperPnl(
            position,
            currentPrice
        );

        const pnlClass =
            pnl >= 0
                ? 'paper-pnl-positive'
                : 'paper-pnl-negative';

        const sideClass =
            position.side === 'LONG'
                ? 'paper-position-long'
                : 'paper-position-short';

        html += `
            <div class="paper-open-position ${sideClass}">
                <div class="paper-position-title">
                    Açık Pozisyon ·
                    ${position.symbol}
                    · ${position.side}
                </div>

                <div class="paper-position-details">
                    <div>
                        Giriş:
                        <strong>
                            ${formatPaperPrice(position.entry)}
                        </strong>
                    </div>

                    <div>
                        Anlık:
                        <strong>
                            ${formatPaperPrice(currentPrice)}
                        </strong>
                    </div>

                    <div>
                        Miktar:
                        <strong>
                            ${position.quantity.toFixed(4)}
                        </strong>
                    </div>

                    <div>
                        Kaldıraç:
                        <strong>
                            ${position.leverage}x
                        </strong>
                    </div>

                    <div>
                        SL:
                        <strong>
                            ${formatPaperPrice(position.stopLoss)}
                        </strong>
                    </div>

                    <div>
                        TP1:
                        <strong>
                            ${formatPaperPrice(position.tp1)}
                        </strong>
                    </div>

                    <div>
                        TP2:
                        <strong>
                            ${formatPaperPrice(position.tp2)}
                        </strong>
                    </div>

                    <div>
                        TP3:
                        <strong>
                            ${formatPaperPrice(position.tp3)}
                        </strong>
                    </div>

                    <div class="${pnlClass}">
                        PNL:
                        ${formatUsdt(pnl)}
                    </div>

                    <div class="${pnlClass}">
                        PNL %:
                        ${pnlPercent.toFixed(2)}%
                    </div>
                </div>

                <button
                    id="manualClosePaperPosition"
                    class="secondary-btn"
                    type="button"
                    style="margin-top: 12px; width: 100%;">
                    Pozisyonu Manuel Kapat
                </button>
            </div>
        `;
    } else {
        html += `
            <div class="paper-trade-preview">
                Açık sanal pozisyon bulunmuyor.
            </div>
        `;
    }

    if (appState.paperHistory.length > 0) {
        html += `
            <div class="paper-history">
                <div class="paper-history-title">
                    İşlem Geçmişi
                </div>
        `;

        appState.paperHistory.forEach(item => {
            const historyClass =
                item.pnl >= 0
                    ? 'paper-history-win'
                    : 'paper-history-loss';

            html += `
                <div class="paper-history-item ${historyClass}">
                    <strong>
                        ${item.symbol} · ${item.side}
                    </strong>
                    <br>
                    Giriş:
                    ${formatPaperPrice(item.entry)}
                    <br>
                    Kapanış:
                    ${formatPaperPrice(item.closePrice)}
                    <br>
                    Neden:
                    ${item.closeReason}
                    <br>
                    Sonuç:
                    <strong>
                        ${formatUsdt(item.pnl)}
                    </strong>
                    (${item.pnlPercent.toFixed(2)}%)
                </div>
            `;
        });

        html += `</div>`;
    }

    container.innerHTML = html;

    const manualCloseButton =
        $('manualClosePaperPosition');

    if (manualCloseButton) {
        manualCloseButton.addEventListener(
            'click',
            () => {
                const currentPosition =
                    appState.paperOpenPosition;

                if (!currentPosition) {
                    return;
                }

                const currentPrice =
                    getLivePriceForPosition(
                        currentPosition
                    ) || currentPosition.entry;

                closePaperPosition(
                    'Manuel kapanış',
                    currentPrice
                );
            }
        );
    }
}

function bindPaperTradingActions() {
    const paperButton = $('paperTradeButton');
    const closeButton = $('closePaperTrading');
    const confirmButton = $('confirmPaperTrade');

    const riskInput = $('paperRiskPercent');
    const leverageInput = $('paperLeverage');

    if (paperButton) {
        paperButton.addEventListener(
            'click',
            () => {
                if (appState.selectedSignal) {
                    showPaperTrading(
                        appState.selectedSignal
                    );
                } else {
                    alert(
                        'Önce bir işlem planı seçmelisin.'
                    );
                }
            }
        );
    }

    if (closeButton) {
        closeButton.addEventListener(
            'click',
            closePaperTrading
        );
    }

    if (confirmButton) {
        confirmButton.addEventListener(
            'click',
            openPaperPosition
        );
    }

    if (riskInput) {
        riskInput.addEventListener(
            'input',
            renderPaperTradePreview
        );
    }

    if (leverageInput) {
        leverageInput.addEventListener(
            'input',
            renderPaperTradePreview
        );
    }
}


/* =========================================
   BAŞLAT
========================================= */

function initApp() {
    renderStats();
    showView('markets');
    bindNavigation();
    bindActions();
    bindTradePlanActions();
   
   loadPaperTradingState();
    bindPaperTradingActions();
    renderPaperTradingSection();

    setConnection('offline', 'Hazır');
    setStatus(
        'Teknik analiz için "Piyasaları Tara" butonuna basın.'
    );

    console.log(
        'Futures Signal Scanner V2 — Aşama 4 hazır.'
    );
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

