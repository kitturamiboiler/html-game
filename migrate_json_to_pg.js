// migrate_json_to_pg.js
// JSON -> PostgreSQL 1회 마이그레이션 스크립트

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL 환경변수가 필요합니다.");
    process.exit(1);
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

const dataDir = path.join(__dirname, "server", "data");

function readJSON(name, fallback) {
    const file = path.join(dataDir, name);
    if (!fs.existsSync(file)) {
        console.warn("⚠️ 파일 없음:", name);
        return fallback;
    }
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

async function run() {
    try {
        console.log("📂 JSON 읽는 중...");

        const userData = readJSON("user_data.json", {});
        const userMap = readJSON("user_map.json", {});
        const attendance = readJSON("attendance.json", {});
        const mineAttempts = readJSON("mine_attempts.json", {});
        const saving = readJSON("saving.json", {});
        const stocks = readJSON("stocks.json", {});

        console.log("✅ JSON 로드 완료, DB 마이그레이션 시작...");

        // 1) user_map
        console.log("➡ user_map 마이그레이션");
        for (const [discordId, name] of Object.entries(userMap)) {
            if (!name) continue;
            await pool.query(
                `INSERT INTO user_map (discord_id, name)
                 VALUES ($1, $2)
                 ON CONFLICT (discord_id) DO UPDATE SET name = EXCLUDED.name`,
                [discordId, name]
            );
        }

        // 2) users (+ room 정보)
        console.log("➡ users / room_* 마이그레이션");
        for (const [discordId, u] of Object.entries(userData)) {
            const name =
                u.name ||
                userMap[discordId] ||
                "유저" + (1000 + Math.floor(Math.random() * 9000));

            await pool.query(
                `INSERT INTO users (discord_id, name, balance, join_date)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (discord_id)
                 DO UPDATE SET name = EXCLUDED.name,
                               balance = EXCLUDED.balance`,
                [discordId, Number(u.balance) || 0, u.joinDate || Date.now()]
            );

            // 방 스킨/현재 방
            if (Array.isArray(u.ownedRooms)) {
                for (const skin of u.ownedRooms) {
                    await pool.query(
                        `INSERT INTO room_skins (discord_id, skin)
                         VALUES ($1, $2)
                         ON CONFLICT (discord_id, skin) DO NOTHING`,
                        [discordId, skin]
                    );
                }
            }
            if (u.currentRoom) {
                await pool.query(
                    `INSERT INTO room_current (discord_id, skin)
                     VALUES ($1, $2)
                     ON CONFLICT (discord_id)
                     DO UPDATE SET skin = EXCLUDED.skin`,
                    [discordId, u.currentRoom]
                );
            }
        }

        // 3) attendance
        console.log("➡ attendance 마이그레이션");
        for (const [discordId, a] of Object.entries(attendance)) {
            if (!a) continue;
            await pool.query(
                `INSERT INTO attendance (discord_id, last_date, days, streak)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (discord_id)
                 DO UPDATE SET last_date = EXCLUDED.last_date,
                               days      = EXCLUDED.days,
                               streak    = EXCLUDED.streak`,
                [discordId, a.lastDate || "", a.days || [], a.streak || 0]
            );
        }

        // 4) mine
        console.log("➡ mine 마이그레이션");
        for (const [discordId, m] of Object.entries(mineAttempts)) {
            if (!m) continue;
            await pool.query(
                `INSERT INTO mine (discord_id, last_day, count)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (discord_id)
                 DO UPDATE SET last_day = EXCLUDED.last_day,
                               count    = EXCLUDED.count`,
                [discordId, m.lastDay || "", m.count || 0]
            );
        }

        // 5) savings
        console.log("➡ savings 마이그레이션");
        for (const [discordId, arr] of Object.entries(saving)) {
            if (!Array.isArray(arr)) continue;
            for (const s of arr) {
                await pool.query(
                    `INSERT INTO savings
                     (id, discord_id, product, amount, days, rate, tax,
                      start_date, end_date, paid)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                     ON CONFLICT (id) DO NOTHING`,
                    [
                        s.id,
                        discordId,
                        s.product,
                        String(s.amount),        // BIGINT/NUMERIC
                        s.days || 0,
                        s.rate || 0,
                        s.tax || 0,
                        s.startDate || "",
                        s.endDate || "",
                        !!s.paid,
                    ]
                );
            }
        }

        // 6) stocks
        console.log("➡ stocks 마이그레이션");
        for (const [discordId, obj] of Object.entries(stocks)) {
            if (!obj) continue;
            for (const [symbol, st] of Object.entries(obj)) {
                await pool.query(
                    `INSERT INTO stocks (discord_id, symbol, amount, avg_price)
                     VALUES ($1,$2,$3,$4)
                     ON CONFLICT (discord_id, symbol)
                     DO UPDATE SET amount = EXCLUDED.amount,
                                   avg_price = EXCLUDED.avg_price`,
                    [
                        discordId,
                        symbol,
                        Number(st.amount) || 0,
                        Number(st.avg_price) || 0,
                    ]
                );
            }
        }

        console.log("🎉 마이그레이션 완료!");
    } catch (err) {
        console.error("❌ 마이그레이션 중 오류:", err);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

run();
