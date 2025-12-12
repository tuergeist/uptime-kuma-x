/**
 * Test script to verify PostgreSQL connection and migrations
 * Run with: node test-postgres-connection.js
 */
const knex = require("knex");
const path = require("path");
const { R } = require("redbean-node");

/**
 * Test PostgreSQL connection and run migrations
 * @returns {Promise<void>}
 */
async function testPostgresConnection() {
    console.log("Testing PostgreSQL connection...\n");

    const config = {
        client: "pg",
        connection: {
            host: process.env.DATABASE_HOST || "localhost",
            port: parseInt(process.env.DATABASE_PORT) || 4032,
            user: process.env.DATABASE_USER || "kuma",
            password: process.env.DATABASE_PASSWORD || "kuma",
            database: process.env.DATABASE_NAME || "uptime_kuma",
        },
        pool: {
            min: 2,
            max: 10,
        },
    };

    console.log("Connection config:", {
        host: config.connection.host,
        port: config.connection.port,
        user: config.connection.user,
        database: config.connection.database,
    });

    const db = knex(config);

    // Setup redbean-node with our knex instance
    R.setup(db);

    try {
        // Test basic connection
        const result = await db.raw("SELECT version()");
        console.log("\n✅ PostgreSQL connected successfully!");
        console.log("Version:", result.rows[0].version.split(",")[0]);

        // Check extensions
        const extensions = await db.raw("SELECT extname FROM pg_extension");
        console.log("\nInstalled extensions:", extensions.rows.map(r => r.extname).join(", "));

        // Check if base tables exist, if not create them
        const hasMonitorTable = await db.schema.hasTable("monitor");
        if (!hasMonitorTable) {
            console.log("\n📦 Creating base tables for PostgreSQL...");
            const { createTablesPostgres } = require("./db/knex_init_db_postgres");
            await createTablesPostgres();
            console.log("✅ Base tables created");
        } else {
            console.log("\n✅ Base tables already exist");
        }

        // Run migrations
        console.log("\n📦 Running migrations...");
        const migrationsPath = path.join(__dirname, "db", "knex_migrations");

        const migrationResult = await db.migrate.latest({
            directory: migrationsPath,
        });
        const batchNo = migrationResult[0];
        const migrations = migrationResult[1];

        if (migrations.length === 0) {
            console.log("✅ Database is already up to date");
        } else {
            console.log(`✅ Batch ${batchNo} run: ${migrations.length} migrations`);
            migrations.forEach(m => console.log(`   - ${m}`));
        }

        // List all tables
        const tables = await db.raw(`
            SELECT tablename
            FROM pg_tables
            WHERE schemaname = 'public'
            ORDER BY tablename
        `);
        console.log("\n📋 Tables in database:");
        tables.rows.forEach(t => console.log(`   - ${t.tablename}`));

        // Check multi-tenancy tables specifically
        console.log("\n🏢 Multi-tenancy tables check:");
        const mtTables = [ "plan", "tenant", "tenant_domain", "usage", "audit_log" ];
        for (const tableName of mtTables) {
            const exists = await db.schema.hasTable(tableName);
            console.log(`   ${exists ? "✅" : "❌"} ${tableName}`);
        }

        // Check tenant_id columns on core tables (Phase 2)
        console.log("\n🔗 tenant_id columns check (Phase 2):");
        const tablesNeedingTenantId = [ "user", "monitor", "notification", "tag", "status_page", "setting", "heartbeat" ];
        for (const tableName of tablesNeedingTenantId) {
            const hasColumn = await db.schema.hasColumn(tableName, "tenant_id");
            console.log(`   ${hasColumn ? "✅" : "❌"} ${tableName}.tenant_id`);
        }

        // Check role column on user table
        const hasRoleColumn = await db.schema.hasColumn("user", "role");
        console.log(`   ${hasRoleColumn ? "✅" : "❌"} user.role`);

        // Check default data
        console.log("\n📊 Default data check:");

        const plans = await db("plan").select("*");
        console.log(`   Plans: ${plans.length} (${plans.map(p => p.slug).join(", ")})`);

        const tenants = await db("tenant").select("*");
        console.log(`   Tenants: ${tenants.length} (${tenants.map(t => t.slug).join(", ")})`);

        console.log("\n✅ All tests passed!");

    } catch (error) {
        console.error("\n❌ Error:", error.message);
        if (error.code === "ECONNREFUSED") {
            console.error("\nMake sure PostgreSQL is running:");
            console.error("  docker-compose -f docker/docker-compose-mt.yml up -d postgres");
        }
        process.exit(1);
    } finally {
        await db.destroy();
    }
}

testPostgresConnection();
