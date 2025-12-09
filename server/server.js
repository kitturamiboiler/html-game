const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, "../public")));

/* ============================================
   ⭐ 수량 파싱 (1A, 2B', 3C'' 등)
============================================ */
function parseAmount(text) {
    if (typeof text === "number") return text;
    if (!text) return NaN;

    text = String(text).trim().toUpperCase();

    // Pure number
    if (!isNaN(Number(text))) return Number(text);

    // Format: 1A , 2B', 3C''
    const m = text.match(/^([0-9\.]+)\s*([A-Z])(\'*)$/);
    if (!m) return NaN;

    const num = parseFloat(m[1]);
    const unit = m[2];
    const tier = m[3].length;

    const base = unit.charCodeAt(0) - 65; // A=0, B=1..s
    const exp = (base + 1) + (tier * 26);

    return num * (1000 ** exp);
}

/* ============================================
   ⭐ Atomic Save — JSON 데이터 안전 저장
============================================ */
function atomicSave(filePath, data) {
    const temp = filePath + ".tmp";
    try {
        fs.writeFileSync(temp, JSON.stringify(data, null, 2));
        fs.renameSync(temp, filePath);
    } catch (e) {
        console.error("❌ Atomic Save Failed:", e);
        if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
}

/* ============================================
   ⭐ JSON 로드/세이브
============================================ */
function loadJSON(fileName) {
    const file = `./server/data/${fileName}`;
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

function saveJSON(fileName, data) {
    atomicSave(`./server/data/${fileName}`, data);
}

/* ============================================
   날짜 YYYY-MM-DD
============================================ */
function ymd(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/* ============================================
   저장 파일 목록
============================================ */
const FILES = {
    user: "user_data.json",
    saving: "saving.json",
    mine: "mine_attempts.json",
    attendance: "attendance.json",
    userMap: "user_map.json"
};

const getUsers = () => loadJSON(FILES.user);
const saveUsers = (d) => saveJSON(FILES.user, d);

/* ============================================
   숫자 → 단위 변환 (A~Z)
============================================ */
function formatBalance(num) {
    if (num < 1000) return Math.floor(num);
    const units = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

    let power = 0;
    while (num >= 1000) {
        num /= 1000;
        power++;
    }

    const unitIndex = (power - 1) % 26;
    const apostrophe = Math.floor((power - 1) / 26);

    return num.toFixed(2) + units[unitIndex] + "'".repeat(apostrophe);
}

/* ============================================
   🔐 로그인
============================================ */
const userMap = loadJSON(FILES.userMap);

app.post("/api/login", (req, res) => {
    const { discordId } = req.body;
    if (!discordId) return res.json({ error: "Discord ID 필요" });

    const users = getUsers();

    if (!users[discordId]) {
        const newName = userMap[discordId] || "유저" + (1000 + Math.floor(Math.random() * 9000));
        users[discordId] = {
            name: newName,
            balance: 0,
            joinDate: Date.now()
        };
        saveUsers(users);

        return res.json({
            status: "new",
            name: newName,
            balance: 0
        });
    }

    return res.json({
        status: "ok",
        name: users[discordId].name,
        balance: users[discordId].balance
    });
});

/* ============================================
   💰 잔액 조회
============================================ */
app.get("/api/balance", (req, res) => {
    const id = req.query.id;
    const users = getUsers();
    if (!users[id]) return res.json({ error: "로그인 필요" });

    res.json({
        balance: users[id].balance,
        formatted: formatBalance(users[id].balance),
        name: users[id].name
    });
});

/* ============================================
   🏷 닉네임 변경
============================================ */
app.post("/api/setname", (req, res) => {
    const { id, name } = req.body;
    const users = getUsers();
    if (!users[id]) return res.json({ error: "유저 없음" });

    users[id].name = name;
    saveUsers(users);

    res.json({ ok: true });
});

/* ============================================
   🎰 잭팟
============================================ */
app.post("/api/jackpot", (req, res) => {
    const { id, bet } = req.body;
    const users = getUsers();
    if (!users[id]) return res.json({ error: "로그인 필요" });
    if (users[id].balance < bet) return res.json({ error: "잔액 부족" });

    users[id].balance -= bet;

    const symbols = ["7️⃣","🍎","🍉","🍌","🍇","1️⃣","2️⃣","3️⃣","4️⃣","5️⃣"];
    const r = () => symbols[Math.floor(Math.random() * symbols.length)];
    const s1 = r(), s2 = r(), s3 = r();

    let reward = 0;
    if (s1 === "7️⃣" && s2 === "7️⃣" && s3 === "7️⃣") reward = bet * 1000;
    else if (s1 === s2 && s2 === s3 && s1 !== "4️⃣") reward = bet * 250;
    else if (s1 === "4️⃣" && s2 === "4️⃣" && s3 === "4️⃣") reward = -bet * 444;

    users[id].balance += reward;
    saveUsers(users);

    res.json({
        result: [s1, s2, s3],
        reward,
        balance: users[id].balance,
        formatted: formatBalance(users[id].balance)
    });
});

/* ============================================
   🏆 랭킹
============================================ */
app.get("/api/rank", (req, res) => {
    const users = getUsers();
    const list = Object.entries(users)
        .map(([id, u]) => ({
            id,
            name: u.name,
            balance: u.balance,
            formatted: formatBalance(u.balance)
        }))
        .sort((a, b) => b.balance - a.balance)
        .slice(0, 10);

    res.json({ ranking: list });
});

/* ============================================
   🎟 출석 정보 조회
============================================ */
app.get("/api/attendance/info", (req, res) => {
    const id = req.query.id;
    const users = getUsers();
    const att = loadJSON(FILES.attendance);

    if (!users[id]) return res.json({ error: "유저 없음" });

    if (!att[id]) {
        att[id] = { lastDate: "", days: [], streak: 0 };
        saveJSON(FILES.attendance, att);
    }

    const today = new Date();
    const todayStr = ymd(today);

    const y = today.getFullYear();
    const m = today.getMonth() + 1;

    const attendedDays = att[id].days
        .filter(t => t.startsWith(`${y}-${String(m).padStart(2, "0")}`))
        .map(t => Number(t.slice(-2)));

    res.json({
        streak: att[id].streak,
        weekIndex: ((att[id].streak - 1) % 7) + 1,
        attendedDays,
        alreadyToday: att[id].lastDate === todayStr
    });
});

/* ============================================
   🎟 출석 체크
============================================ */
app.post("/api/attendance", (req, res) => {
    const { id } = req.body;
    const users = getUsers();
    const att = loadJSON(FILES.attendance);

    if (!users[id]) return res.json({ error: "로그인 필요" });

    if (!att[id]) att[id] = { lastDate: "", days: [], streak: 0 };

    const today = new Date();
    const todayStr = ymd(today);
    const u = att[id];

    if (u.lastDate === todayStr)
        return res.json({ error: "이미 오늘 출석했습니다" });

    const yesterday = ymd(new Date(Date.now() - 86400000));

    if (u.lastDate === yesterday) u.streak++;
    else u.streak = 1;

    let reward = 3000;
    let weeklyBonus = 0;
    let monthlyBonus = 0;

    if (u.streak % 7 === 0) {
        weeklyBonus = 5000;
        reward += weeklyBonus;
    }

    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    if (today.getDate() === lastDay) {
        monthlyBonus = 10000;
        reward += monthlyBonus;
    }

    users[id].balance += reward;
    u.lastDate = todayStr;

    if (!u.days.includes(todayStr)) u.days.push(todayStr);

    saveUsers(users);
    saveJSON(FILES.attendance, att);

    const attendedDaysMonth = u.days
        .filter(t => t.startsWith(todayStr.slice(0, 7)))
        .map(t => Number(t.slice(-2)));

    res.json({
        ok: true,
        reward,
        weeklyBonus,
        monthlyBonus,
        streak: u.streak,
        weekIndex: ((u.streak - 1) % 7) + 1,
        attendedDays: attendedDaysMonth
    });
});

/* ============================================
   💰 적금 조회 + 만기 자동 지급
============================================ */
app.get("/api/saving/info", (req, res) => {
    const id = req.query.id;
    const users = getUsers();
    if (!users[id]) return res.json({ error: "유저 없음" });

    const saving = loadJSON(FILES.saving);
    if (!saving[id]) saving[id] = [];

    const today = new Date();
    const todayStr = ymd(today);

    const payouts = [];
    let changed = false;

    saving[id].forEach(item => {
        if (item.paid) return;
        if (item.endDate > todayStr) return;

        const amt = Number(item.amount);
        let interest = 0;
        let taxAmount = 0;

        if (item.product === "soso") {
            interest = Math.floor(amt * (item.rate / 100));
        } else {
            const gross = amt * item.rate;
            taxAmount = Math.floor(gross * (item.tax / 100));
            interest = gross - taxAmount;
        }

        const payout = amt + interest;

        users[id].balance += payout;
        item.paid = true;

        payouts.push({ ...item, interest, taxAmount, payout });
        changed = true;
    });

    if (changed) {
        saveUsers(users);
        saveJSON(FILES.saving, saving);
    }

    const active = saving[id]
        .filter(s => !s.paid)
        .map(s => {
            const end = new Date(s.endDate);
            const diff = Math.ceil((end - today) / 86400000);
            return { ...s, remainDays: Math.max(0, diff) };
        });

    res.json({
        active,
        payouts,
        balance: users[id].balance,
        formatted: formatBalance(users[id].balance),
        maxSlots: 2
    });
});

/* ============================================
   💰 적금 가입
============================================ */
app.post("/api/saving/join", (req, res) => {
    const { id, product, amount } = req.body;
    const users = getUsers();
    if (!users[id]) return res.json({ error: "로그인 필요" });

    const saving = loadJSON(FILES.saving);
    if (!saving[id]) saving[id] = [];

    const amt = Number(amount);
    if (!amt || amt <= 0) return res.json({ error: "금액 오류" });
    if (users[id].balance < amt) return res.json({ error: "잔액 부족" });

    if (saving[id].filter(s => !s.paid).length >= 2)
        return res.json({ error: "적금은 최대 2개까지 가능합니다." });

    let days, rate, tax;

    if (product === "soso") {
        days = 1 + Math.floor(Math.random() * 10);
        rate = 10 + Math.floor(Math.random() * 41);
        tax = 0;
    } else if (product === "hanbang") {
        days = 1 + Math.floor(Math.random() * 100);
        rate = Math.floor(Math.random() * 101);
        tax = Math.floor(Math.random() * 51);
    } else {
        return res.json({ error: "상품 오류" });
    }

    const start = ymd(new Date());
    const endObj = new Date();
    endObj.setDate(endObj.getDate() + days);

    const item = {
        id: Date.now().toString(),
        product,
        amount: amt,
        days,
        rate,
        tax,
        startDate: start,
        endDate: ymd(endObj),
        paid: false
    };

    saving[id].push(item);
    users[id].balance -= amt;

    saveUsers(users);
    saveJSON(FILES.saving, saving);

    res.json({
        ok: true,
        saving: item,
        balance: users[id].balance,
        formatted: formatBalance(users[id].balance)
    });
});

/* ============================================
   ⛏ 채굴 정보 조회
============================================ */
app.get("/api/mine/info", (req, res) => {
    const id = req.query.id;
    const users = getUsers();
    if (!users[id]) return res.json({ error: "유저 없음" });

    const mine = loadJSON(FILES.mine);
    const todayStr = ymd(new Date());

    if (!mine[id]) mine[id] = { lastDay: todayStr, count: 0 };

    if (mine[id].lastDay !== todayStr) {
        mine[id].lastDay = todayStr;
        mine[id].count = 0;
    }

    saveJSON(FILES.mine, mine);

    res.json({ left: 3 - mine[id].count });
});

/* ============================================
   ⛏ 채굴 실행
============================================ */
app.post("/api/mine", (req, res) => {
    const { id } = req.body;
    const users = getUsers();
    if (!users[id]) return res.json({ error: "로그인 필요" });

    const mine = loadJSON(FILES.mine);
    const todayStr = ymd(new Date());

    if (!mine[id]) mine[id] = { lastDay: todayStr, count: 0 };

    if (mine[id].lastDay !== todayStr) {
        mine[id].lastDay = todayStr;
        mine[id].count = 0;
    }

    if (mine[id].count >= 3)
        return res.json({ error: "LIMIT" });

    mine[id].count++;

    let reward = 0;
    const r = Math.random();
    if (r < 0.2) reward = 50;
    else if (r < 0.5) reward = 30;
    else reward = 10;

    users[id].balance += reward;

    saveUsers(users);
    saveJSON(FILES.mine, mine);

    res.json({
        ok: true,
        reward,
        left: 3 - mine[id].count
    });
});

/* ============================================
   📈 매수
============================================ */
app.post("/api/stock/buy", (req, res) => {
    const { id, symbol, amount, price } = req.body;

    const buyAmount = parseAmount(amount);

    if (!id || !symbol || !buyAmount || !price)
        return res.json({ error: "매수 데이터 부족 또는 수량 오류" });

    const users = getUsers();
    if (!users[id]) return res.json({ error: "로그인 필요" });

    const total = buyAmount * price;
    if (users[id].balance < total)
        return res.json({ error: "잔액 부족" });

    users[id].balance -= total;
    saveUsers(users);

    const file = "./server/data/stocks.json";
    let stocks = fs.existsSync(file)
        ? JSON.parse(fs.readFileSync(file, "utf8"))
        : {};

    if (!stocks[id]) stocks[id] = {};

    if (!stocks[id][symbol]) {
        stocks[id][symbol] = {
            amount: buyAmount,
            avg_price: price
        };
    } else {
        const old = stocks[id][symbol];
        const newAmount = old.amount + buyAmount;
        const newAvg = ((old.amount * old.avg_price) + (buyAmount * price)) / newAmount;
        stocks[id][symbol] = { amount: newAmount, avg_price: newAvg };
    }

    atomicSave(file, stocks);

    res.json({
        ok: true,
        balance: users[id].balance,
        formatted: formatBalance(users[id].balance)
    });
});

/* ============================================
   📉 매도
============================================ */
app.post("/api/stock/sell", (req, res) => {
    const { id, symbol, amount, price } = req.body;

    const sellAmount = parseAmount(amount);

    if (!id || !symbol || !sellAmount || !price)
        return res.json({ error: "매도 데이터 부족 또는 수량 오류" });

    const users = getUsers();
    if (!users[id]) return res.json({ error: "로그인 필요" });

    const file = "./server/data/stocks.json";
    let stocks = fs.existsSync(file)
        ? JSON.parse(fs.readFileSync(file, "utf8"))
        : {};

    if (!stocks[id] || !stocks[id][symbol])
        return res.json({ error: "보유하지 않은 종목입니다." });

    const owned = stocks[id][symbol].amount;

    if (owned < sellAmount)
        return res.json({ error: "보유 수량 부족" });

    const total = sellAmount * price;

    users[id].balance += total;
    saveUsers(users);

    const newAmount = owned - sellAmount;

    if (newAmount <= 0) delete stocks[id][symbol];
    else stocks[id][symbol].amount = newAmount;

    atomicSave(file, stocks);

    res.json({
        ok: true,
        balance: users[id].balance,
        formatted: formatBalance(users[id].balance)
    });
});

/* ============================================
   📦 보유 주식 조회
============================================ */
app.get("/api/stocks", (req, res) => {
    const file = "./server/data/stocks.json";

    if (!fs.existsSync(file)) {
        return res.json({});
    }

    const stocks = JSON.parse(fs.readFileSync(file, "utf8"));
    res.json(stocks);
});

/* ============================================
    🛒 방 스킨 구매
============================================ */
app.post("/api/buyRoomSkin", (req, res) => {
    const { id, skin, price } = req.body;

    // 가격 숫자 변환
    const realPrice = Number(price);

    if (!id || !skin || isNaN(realPrice))
        return res.json({ error: "잘못된 요청" });

    const users = getUsers();
    if (!users[id]) return res.json({ error: "유저 없음" });

    const user = users[id];

    // ownedRooms 없으면 생성
    if (!user.ownedRooms) user.ownedRooms = ["Room1"];

    // 이미 구매함
    if (user.ownedRooms.includes(skin)) {
        return res.json({ success: true, already: true });
    }

    // 잔액 부족
    if (user.balance < realPrice) {
        return res.json({ error: "잔액 부족" });
    }

    // 구매 처리
    user.balance -= realPrice;
    user.ownedRooms.push(skin);

    saveUsers(users);

    return res.json({
        success: true,
        ownedRooms: user.ownedRooms,
        balance: user.balance
    });
});
/* ============================================
   🏠 방 스킨 불러오기 API
============================================ */
app.get("/api/rooms", (req, res) => {
    const id = req.query.id;
    const users = getUsers();

    if (!users[id]) return res.json({ error: "유저 없음" });

    const user = users[id];

    if (!user.ownedRooms) user.ownedRooms = ["Room1"];
    if (!user.currentRoom) user.currentRoom = "Room1";

    saveUsers(users);

    res.json({
        ownedRooms: user.ownedRooms,
        currentRoom: user.currentRoom
    });
});
/* ============================================
   🏠 방 스킨 적용 API
============================================ */
app.post("/api/applyRoomSkin", (req, res) => {
    const { id, skin } = req.body;

    const users = getUsers();
    if (!users[id]) return res.json({ error: "유저 없음" });

    const user = users[id];

    if (!user.ownedRooms) user.ownedRooms = ["Room1"];

    // 보유하지 않은 스킨 적용 방지
    if (!user.ownedRooms.includes(skin)) {
        return res.json({ error: "구매하지 않은 스킨입니다." });
    }

    user.currentRoom = skin;
    saveUsers(users);

    res.json({ success: true, currentRoom: skin });
});
/* ============================================
   🚀 서버 실행
============================================ */
app.listen(PORT, () => {
    console.log(`🚀 Server Running on port ${PORT}`);
});



