// server/server.js

const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

// ========================
// 기본 미들웨어
// ========================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "../public")));

// ========================
// PostgreSQL 연결
// ========================
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

pool.connect()
    .then(() => console.log("📌 PostgreSQL Connected!"))
    .catch(err => console.error("❌ PostgreSQL Connection Error:", err));

// ========================
// 공용 유틸
// ========================
function parseAmount(text) {
    if (typeof text === "number") return text;
    if (!text) return NaN;

    text = String(text).trim().toUpperCase();

    if (!isNaN(Number(text))) return Number(text);

    // 1A, 2B', 3C'' ...
    const m = text.match(/^([0-9\.]+)\s*([A-Z])(\'*)$/);
    if (!m) return NaN;

    const num = parseFloat(m[1]);
    const unit = m[2];
    const tier = m[3].length;

    const base = unit.charCodeAt(0) - 65; // A=0, B=1...
    const exp = (base + 1) + (tier * 26);

    return num * (1000 ** exp);
}

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

function ymd(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// 유저 존재 확인 + row 가져오기
async function getUser(discordId) {
    const { rows } = await pool.query(
        "SELECT discord_id, name, balance, join_date FROM users WHERE discord_id = $1",
        [discordId]
    );
    return rows[0] || null;
}

// ========================
// 🔐 로그인
// ========================
app.post("/api/login", async (req, res) => {
    const { discordId } = req.body;
    if (!discordId) return res.json({ error: "Discord ID 필요" });

    try {
        let user = await getUser(discordId);

        // 신규 유저면 생성
        if (!user) {
            // user_map 에서 기본 닉네임 찾아보기
            const mapRes = await pool.query(
                "SELECT name FROM user_map WHERE discord_id = $1",
                [discordId]
            );
            const mapped = mapRes.rows[0];
            const newName =
                mapped?.name ||
                "유저" + (1000 + Math.floor(Math.random() * 9000));

            const joinDate = Date.now();

            await pool.query(
                "INSERT INTO users (discord_id, name, balance, join_date) VALUES ($1, $2, 0, $3)",
                [discordId, newName, joinDate]
            );

            return res.json({
                status: "new",
                name: newName,
                balance: 0,
            });
        }

        // 기존 유저
        return res.json({
            status: "ok",
            name: user.name,
            balance: user.balance,
        });
    } catch (err) {
        console.error("login error:", err);
        res.status(500).json({ error: "서버 오류" });
    }
});

// ========================
// 💰 잔액 조회
// ========================
app.get("/api/balance", async (req, res) => {
    const id = req.query.id;
    if (!id) return res.json({ error: "ID 필요" });

    try {
        const user = await getUser(id);
        if (!user) return res.json({ error: "로그인 필요" });

        res.json({
            balance: user.balance,
            formatted: formatBalance(user.balance),
            name: user.name,
        });
    } catch (err) {
        console.error("balance error:", err);
        res.status(500).json({ error: "서버 오류" });
    }
});

// ========================
// 🏷 닉네임 변경
// ========================
app.post("/api/setname", async (req, res) => {
    const { id, name } = req.body;
    if (!id || !name) return res.json({ error: "데이터 부족" });

    try {
        const user = await getUser(id);
        if (!user) return res.json({ error: "유저 없음" });

        await pool.query(
            "UPDATE users SET name = $2 WHERE discord_id = $1",
            [id, name]
        );

        res.json({ ok: true });
    } catch (err) {
        console.error("setname error:", err);
        res.status(500).json({ error: "서버 오류" });
    }
});

// ========================
// 🎰 잭팟
// ========================
app.post("/api/jackpot", async (req, res) => {
    const { id, bet } = req.body;
    if (!id || !bet) return res.json({ error: "데이터 부족" });

    try {
        const user = await getUser(id);
        if (!user) return res.json({ error: "로그인 필요" });

        const betNum = Number(bet);
        if (user.balance < betNum) return res.json({ error: "잔액 부족" });

        const symbols = ["7️⃣", "🍎", "🍉", "🍌", "🍇", "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"];
        const r = () => symbols[Math.floor(Math.random() * symbols.length)];
        const s1 = r(), s2 = r(), s3 = r();

        let reward = 0;
        if (s1 === "7️⃣" && s2 === "7️⃣" && s3 === "7️⃣") reward = betNum * 1000;
        else if (s1 === s2 && s2 === s3 && s1 !== "4️⃣") reward = betNum * 250;
        else if (s1 === "4️⃣" && s2 === "4️⃣" && s3 === "4️⃣") reward = -betNum * 444;

        const newBalance = user.balance - betNum + reward;

        await pool.query(
            "UPDATE users SET balance = $2 WHERE discord_id = $1",
            [id, newBalance]
        );

        res.json({
            result: [s1, s2, s3],
            reward,
            balance: newBalance,
            formatted: formatBalance(newBalance),
        });
    } catch (err) {
        console.error("jackpot error:", err);
        res.status(500).json({ error: "서버 오류" });
    }
});

// ========================
// 🏆 랭킹
// ========================
app.get("/api/rank", async (req, res) => {
    try {
        const { rows } = await pool.query(
            "SELECT discord_id, name, balance FROM users ORDER BY balance DESC LIMIT 10"
        );

        const list = rows.map(r => ({
            id: r.discord_id,
            name: r.name,
            balance: r.balance,
            formatted: formatBalance(r.balance),
        }));

        res.json({ ranking: list });
    } catch (err) {
        console.error("rank error:", err);
        res.status(500).json({ error: "서버 오류" });
    }
});

// ========================
// 🎟 출석 정보 조회
// ========================
app.get("/api/attendance/info", async (req, res) => {
    const id = req.query.id;
    if (!id) return res.json({ error: "ID 필요" });

    try {
        const user = await getUser(id);
        if (!user) return res.json({ error: "유저 없음" });

        let attRow;
        {
            const { rows } = await pool.query(
                "SELECT last_date, days, streak FROM attendance WHERE discord_id = $1",
                [id]
            );
            attRow = rows[0];

            if (!attRow) {
                await pool.query(
                    "INSERT INTO attendance (discord_id, last_date, days, streak) VALUES ($1, $2, $3, $4)",
                    [id, "", [], 0]
                );
                attRow = { last_date: "", days: [], streak: 0 };
            }
        }

        const today = new Date();
        const todayStr = ymd(today);
        const y = today.getFullYear();
        const m = today.getMonth() + 1;

        const days = attRow.days || [];
        const attendedDays = days
            .filter(t => t.startsWith(`${y}-${String(m).padStart(2, "0")}`))
            .map(t => Number(t.slice(-2)));

        res.json({
            streak: attRow.streak,
            weekIndex: ((attRow.streak - 1) % 7) + 1,
            attendedDays,
            alreadyToday: attRow.last_date === todayStr,
        });
    } catch (err) {
        console.error("attendance/info error:", err);
        res.status(500).json({ error: "서버 오류" });
    }
});

// ========================
// 🎟 출석 체크
// ========================
app.post("/api/attendance", async (req, res) => {
    const { id } = req.body;
    if (!id) return res.json({ error: "ID 필요" });

    try {
        const user = await getUser(id);
        if (!user) return res.json({ error: "로그인 필요" });

        const today = new Date();
        const todayStr = ymd(today);
        const yesterday = ymd(new Date(Date.now() - 86400000));

        let attRow;
        {
            const { rows } = await pool.query(
                "SELECT last_date, days, streak FROM attendance WHERE discord_id = $1",
                [id]
            );
            attRow = rows[0];

            if (!attRow) {
                attRow = { last_date: "", days: [], streak: 0 };
            }
        }

        if (attRow.last_date === todayStr)
            return res.json({ error: "이미 오늘 출석했습니다" });

        let streak = attRow.streak || 0;
        if (attRow.last_date === yesterday) streak++;
        else streak = 1;

        let reward = 3000;
        let weeklyBonus = 0;
        let monthlyBonus = 0;

        if (streak % 7 === 0) {
            weeklyBonus = 5000;
            reward += weeklyBonus;
        }

        const lastDayOfMonth = new Date(
            today.getFullYear(),
            today.getMonth() + 1,
            0
        ).getDate();

        if (today.getDate() === lastDayOfMonth) {
            monthlyBonus = 10000;
            reward += monthlyBonus;
        }

        const days = attRow.days || [];
        if (!days.includes(todayStr)) days.push(todayStr);

        const newBalance = user.balance + reward;

        await pool.query("BEGIN");
        await pool.query(
            "UPDATE users SET balance = $2 WHERE discord_id = $1",
            [id, newBalance]
        );
        await pool.query(
            `INSERT INTO attendance (discord_id, last_date, days, streak)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (discord_id)
             DO UPDATE SET last_date = EXCLUDED.last_date,
                           days = EXCLUDED.days,
                           streak = EXCLUDED.streak`,
            [id, todayStr, days, streak]
        );
        await pool.query("COMMIT");

        const attendedDaysMonth = days
            .filter(t => t.startsWith(todayStr.slice(0, 7)))
            .map(t => Number(t.slice(-2)));

        res.json({
            ok: true,
            reward,
            weeklyBonus,
            monthlyBonus,
            streak,
            weekIndex: ((streak - 1) % 7) + 1,
            attendedDays: attendedDaysMonth,
        });
    } catch (err) {
        console.error("attendance error:", err);
        await pool.query("ROLLBACK").catch(() => {});
        res.status(500).json({ error: "서버 오류" });
    }
});

// ========================
// 💰 적금 조회 + 만기 자동 지급
// ========================
app.get("/api/saving/info", async (req, res) => {
    const id = req.query.id;
    if (!id) return res.json({ error: "ID 필요" });

    try {
        const user = await getUser(id);
        if (!user) return res.json({ error: "유저 없음" });

        const today = new Date();
        const todayStr = ymd(today);

        const { rows } = await pool.query(
            "SELECT * FROM savings WHERE discord_id = $1",
            [id]
        );

        const payouts = [];
        let newBalance = user.balance;

        for (const item of rows) {
            if (item.paid) continue;
            if (item.end_date > todayStr) continue;

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
            newBalance += payout;

            payouts.push({
                ...item,
                interest,
                taxAmount,
                payout,
            });
        }

        await pool.query("BEGIN");
        // balance 업데이트
        if (newBalance !== user.balance) {
            await pool.query(
                "UPDATE users SET balance = $2 WHERE discord_id = $1",
                [id, newBalance]
            );
        }

        // 만기된 적금 paid 처리
        for (const p of payouts) {
            await pool.query(
                "UPDATE savings SET paid = TRUE WHERE id = $1",
                [p.id]
            );
        }
        await pool.query("COMMIT");

        // 아직 안 끝난 적금들
        const active = rows
            .filter(s => !s.paid && s.end_date > todayStr)
            .map(s => {
                const end = new Date(s.end_date);
                const diff = Math.ceil((end - today) / 86400000);
                return { ...s, remainDays: Math.max(0, diff) };
            });

        res.json({
            active,
            payouts,
            balance: newBalance,
            formatted: formatBalance(newBalance),
            maxSlots: 2,
        });
    } catch (err) {
        console.error("saving/info error:", err);
        await pool.query("ROLLBACK").catch(() => {});
        res.status(500).json({ error: "서버 오류" });
    }
});

// ========================
// 💰 적금 가입
// ========================
app.post("/api/saving/join", async (req, res) => {
    const { id, product, amount } = req.body;
    if (!id || !product || !amount) return res.json({ error: "데이터 부족" });

    try {
        const user = await getUser(id);
        if (!user) return res.json({ error: "로그인 필요" });

        const amt = Number(amount);
        if (!amt || amt <= 0) return res.json({ error: "금액 오류" });
        if (user.balance < amt) return res.json({ error: "잔액 부족" });

        const countRes = await pool.query(
            "SELECT COUNT(*) FROM savings WHERE discord_id = $1 AND paid = FALSE",
            [id]
        );
        const activeCount = Number(countRes.rows[0].count || 0);
        if (activeCount >= 2)
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
        const endDate = ymd(endObj);
        const itemId = Date.now().toString();

        const newBalance = user.balance - amt;

        await pool.query("BEGIN");
        await pool.query(
            `INSERT INTO savings
             (id, discord_id, product, amount, days, rate, tax, start_date, end_date, paid)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,FALSE)`,
            [itemId, id, product, amt, days, rate, tax, start, endDate]
        );
        await pool.query(
            "UPDATE users SET balance = $2 WHERE discord_id = $1",
            [id, newBalance]
        );
        await pool.query("COMMIT");

        const saving = {
            id: itemId,
            product,
            amount: amt,
            days,
            rate,
            tax,
            startDate: start,
            endDate,
            paid: false,
        };

        res.json({
            ok: true,
            saving,
            balance: newBalance,
            formatted: formatBalance(newBalance),
        });
    } catch (err) {
        console.error("saving/join error:", err);
        await pool.query("ROLLBACK").catch(() => {});
        res.status(500).json({ error: "서버 오류" });
    }
});

// ========================
// ⛏ 채굴 정보 조회
// ========================
app.get("/api/mine/info", async (req, res) => {
    const id = req.query.id;
    if (!id) return res.json({ error: "ID 필요" });

    try {
        const user = await getUser(id);
        if (!user) return res.json({ error: "유저 없음" });

        const todayStr = ymd(new Date());

        let mineRow;
        {
            const { rows } = await pool.query(
                "SELECT last_day, count FROM mine WHERE discord_id = $1",
                [id]
            );
            mineRow = rows[0];

            if (!mineRow) {
                mineRow = { last_day: todayStr, count: 0 };
                await pool.query(
                    "INSERT INTO mine (discord_id, last_day, count) VALUES ($1,$2,$3)",
                    [id, todayStr, 0]
                );
            }
        }

        let count = mineRow.count || 0;
        if (mineRow.last_day !== todayStr) {
            count = 0;
            await pool.query(
                "UPDATE mine SET last_day = $2, count = $3 WHERE discord_id = $1",
                [id, todayStr, count]
            );
        }

        res.json({ left: 3 - count });
    } catch (err) {
        console.error("mine/info error:", err);
        res.status(500).json({ error: "서버 오류" });
    }
});

// ========================
// ⛏ 채굴 실행
// ========================
app.post("/api/mine", async (req, res) => {
    const { id } = req.body;
    if (!id) return res.json({ error: "ID 필요" });

    try {
        const user = await getUser(id);
        if (!user) return res.json({ error: "로그인 필요" });

        const todayStr = ymd(new Date());

        const { rows } = await pool.query(
            "SELECT last_day, count FROM mine WHERE discord_id = $1",
            [id]
        );
        let mineRow = rows[0];

        if (!mineRow) {
            mineRow = { last_day: todayStr, count: 0 };
        }

        let count = mineRow.count || 0;
        if (mineRow.last_day !== todayStr) {
            count = 0;
        }

        if (count >= 3) return res.json({ error: "LIMIT" });

        count++;

        let reward = 0;
        const r = Math.random();
        if (r < 0.2) reward = 50;
        else if (r < 0.5) reward = 30;
        else reward = 10;

        const newBalance = user.balance + reward;

        await pool.query("BEGIN");
        await pool.query(
            `INSERT INTO mine (discord_id, last_day, count)
             VALUES ($1,$2,$3)
             ON CONFLICT (discord_id)
             DO UPDATE SET last_day = EXCLUDED.last_day,
                           count = EXCLUDED.count`,
            [id, todayStr, count]
        );
        await pool.query(
            "UPDATE users SET balance = $2 WHERE discord_id = $1",
            [id, newBalance]
        );
        await pool.query("COMMIT");

        res.json({
            ok: true,
            reward,
            left: 3 - count,
        });
    } catch (err) {
        console.error("mine error:", err);
        await pool.query("ROLLBACK").catch(() => {});
        res.status(500).json({ error: "서버 오류" });
    }
});

// ========================
// 📈 매수
// ========================
app.post("/api/stock/buy", async (req, res) => {
    const { id, symbol, amount, price } = req.body;
    if (!id || !symbol || !amount || !price)
        return res.json({ error: "매수 데이터 부족 또는 수량 오류" });

    try {
        const buyAmount = parseAmount(amount);
        if (!buyAmount) return res.json({ error: "수량 오류" });

        const user = await getUser(id);
        if (!user) return res.json({ error: "로그인 필요" });

        const total = buyAmount * price;
        if (user.balance < total) return res.json({ error: "잔액 부족" });

        const { rows } = await pool.query(
            "SELECT amount, avg_price FROM stocks WHERE discord_id = $1 AND symbol = $2",
            [id, symbol]
        );
        const stock = rows[0];

        let newAmount, newAvg;
        if (!stock) {
            newAmount = buyAmount;
            newAvg = price;
            await pool.query(
                "INSERT INTO stocks (discord_id, symbol, amount, avg_price) VALUES ($1,$2,$3,$4)",
                [id, symbol, newAmount, newAvg]
            );
        } else {
            const oldAmount = Number(stock.amount);
            const oldAvg = Number(stock.avg_price);
            newAmount = oldAmount + buyAmount;
            newAvg =
                (oldAmount * oldAvg + buyAmount * price) / newAmount;

            await pool.query(
                "UPDATE stocks SET amount = $3, avg_price = $4 WHERE discord_id = $1 AND symbol = $2",
                [id, symbol, newAmount, newAvg]
            );
        }

        const newBalance = user.balance - total;
        await pool.query(
            "UPDATE users SET balance = $2 WHERE discord_id = $1",
            [id, newBalance]
        );

        res.json({
            ok: true,
            balance: newBalance,
            formatted: formatBalance(newBalance),
        });
    } catch (err) {
        console.error("stock/buy error:", err);
        res.status(500).json({ error: "서버 오류" });
    }
});

// ========================
// 📉 매도
// ========================
app.post("/api/stock/sell", async (req, res) => {
    const { id, symbol, amount, price } = req.body;
    if (!id || !symbol || !amount || !price)
        return res.json({ error: "매도 데이터 부족 또는 수량 오류" });

    try {
        const sellAmount = parseAmount(amount);
        if (!sellAmount) return res.json({ error: "수량 오류" });

        const user = await getUser(id);
        if (!user) return res.json({ error: "로그인 필요" });

        const { rows } = await pool.query(
            "SELECT amount FROM stocks WHERE discord_id = $1 AND symbol = $2",
            [id, symbol]
        );
        const stock = rows[0];
        if (!stock) return res.json({ error: "보유하지 않은 종목입니다." });

        const owned = Number(stock.amount);
        if (owned < sellAmount)
            return res.json({ error: "보유 수량 부족" });

        const total = sellAmount * price;
        const newBalance = user.balance + total;

        const newAmount = owned - sellAmount;

        await pool.query("BEGIN");
        if (newAmount <= 0) {
            await pool.query(
                "DELETE FROM stocks WHERE discord_id = $1 AND symbol = $2",
                [id, symbol]
            );
        } else {
            await pool.query(
                "UPDATE stocks SET amount = $3 WHERE discord_id = $1 AND symbol = $2",
                [id, symbol, newAmount]
            );
        }
        await pool.query(
            "UPDATE users SET balance = $2 WHERE discord_id = $1",
            [id, newBalance]
        );
        await pool.query("COMMIT");

        res.json({
            ok: true,
            balance: newBalance,
            formatted: formatBalance(newBalance),
        });
    } catch (err) {
        console.error("stock/sell error:", err);
        await pool.query("ROLLBACK").catch(() => {});
        res.status(500).json({ error: "서버 오류" });
    }
});

// ========================
// 📦 보유 주식 조회
// ========================
app.get("/api/stocks", async (req, res) => {
    try {
        const { rows } = await pool.query(
            "SELECT discord_id, symbol, amount, avg_price FROM stocks"
        );

        const result = {};
        for (const row of rows) {
            if (!result[row.discord_id]) result[row.discord_id] = {};
            result[row.discord_id][row.symbol] = {
                amount: Number(row.amount),
                avg_price: Number(row.avg_price),
            };
        }

        res.json(result);
    } catch (err) {
        console.error("stocks error:", err);
        res.status(500).json({ error: "서버 오류" });
    }
});

// ========================
// 🛒 방 스킨 구매
// ========================
app.post("/api/buyRoomSkin", async (req, res) => {
    const { id, skin, price } = req.body;
    if (!id || !skin || price == null)
        return res.json({ error: "잘못된 요청" });

    const realPrice = Number(price);

    try {
        const user = await getUser(id);
        if (!user) return res.json({ error: "유저 없음" });

        // 이미 보유?
        const hasRes = await pool.query(
            "SELECT 1 FROM room_skins WHERE discord_id = $1 AND skin = $2",
            [id, skin]
        );
        if (hasRes.rowCount > 0) {
            return res.json({ success: true, already: true });
        }

        if (user.balance < realPrice) {
            return res.json({ error: "잔액 부족" });
        }

        const newBalance = user.balance - realPrice;

        await pool.query("BEGIN");
        await pool.query(
            "INSERT INTO room_skins (discord_id, skin) VALUES ($1,$2)",
            [id, skin]
        );
        await pool.query(
            "UPDATE users SET balance = $2 WHERE discord_id = $1",
            [id, newBalance]
        );
        await pool.query("COMMIT");

        res.json({
            success: true,
            ownedRooms: null, // 프론트에서 /api/rooms 다시 호출해서 최신 상태 받게
            balance: newBalance,
        });
    } catch (err) {
        console.error("buyRoomSkin error:", err);
        await pool.query("ROLLBACK").catch(() => {});
        res.status(500).json({ error: "서버 오류" });
    }
});

// ========================
// 🏠 방 스킨 불러오기
// ========================
app.get("/api/rooms", async (req, res) => {
    const id = req.query.id;
    if (!id) return res.json({ error: "ID 필요" });

    try {
        const user = await getUser(id);
        if (!user) return res.json({ error: "유저 없음" });

        // 최소 Room1 확보
        await pool.query(
            `INSERT INTO room_skins (discord_id, skin)
             VALUES ($1, 'Room1')
             ON CONFLICT (discord_id, skin) DO NOTHING`,
            [id]
        );
        await pool.query(
            `INSERT INTO room_current (discord_id, skin)
             VALUES ($1, 'Room1')
             ON CONFLICT (discord_id) DO NOTHING`,
            [id]
        );

        const skinsRes = await pool.query(
            "SELECT skin FROM room_skins WHERE discord_id = $1 ORDER BY skin",
            [id]
        );
        const currentRes = await pool.query(
            "SELECT skin FROM room_current WHERE discord_id = $1",
            [id]
        );

        const ownedRooms = skinsRes.rows.map(r => r.skin);
        const currentRoom =
            currentRes.rows[0]?.skin || "Room1";

        res.json({ ownedRooms, currentRoom });
    } catch (err) {
        console.error("rooms error:", err);
        res.status(500).json({ error: "서버 오류" });
    }
});

// ========================
// 🏠 방 스킨 적용
// ========================
app.post("/api/applyRoomSkin", async (req, res) => {
    const { id, skin } = req.body;
    if (!id || !skin) return res.json({ error: "데이터 부족" });

    try {
        const user = await getUser(id);
        if (!user) return res.json({ error: "유저 없음" });

        const hasRes = await pool.query(
            "SELECT 1 FROM room_skins WHERE discord_id = $1 AND skin = $2",
            [id, skin]
        );
        if (hasRes.rowCount === 0) {
            return res.json({ error: "구매하지 않은 스킨입니다." });
        }

        await pool.query(
            `INSERT INTO room_current (discord_id, skin)
             VALUES ($1,$2)
             ON CONFLICT (discord_id)
             DO UPDATE SET skin = EXCLUDED.skin`,
            [id, skin]
        );

        res.json({ success: true, currentRoom: skin });
    } catch (err) {
        console.error("applyRoomSkin error:", err);
        res.status(500).json({ error: "서버 오류" });
    }
});

// ========================
// 🚀 서버 실행
// ========================
app.listen(PORT, () => {
    console.log(`🚀 Server Running on port ${PORT}`);
});
