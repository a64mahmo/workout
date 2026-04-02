"""
Migrate all data from one user account to another.
Usage: python migrate_user.py <from_email> <to_email>
"""
import sys
import sqlite3

def migrate(db_path, from_email, to_email):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # Look up both users
    cur.execute("SELECT id, email FROM users WHERE email = ?", (from_email,))
    src = cur.fetchone()
    if not src:
        print(f"ERROR: source user '{from_email}' not found.")
        conn.close()
        sys.exit(1)

    cur.execute("SELECT id, email FROM users WHERE email = ?", (to_email,))
    dst = cur.fetchone()
    if not dst:
        print(f"ERROR: destination user '{to_email}' not found.")
        conn.close()
        sys.exit(1)

    src_id, dst_id = src["id"], dst["id"]
    print(f"Source : {from_email} ({src_id})")
    print(f"Dest   : {to_email}  ({dst_id})")

    # Tables that have a user_id column
    tables = ["meso_cycles", "training_sessions", "workout_plans", "health_metrics"]

    for table in tables:
        cur.execute(f"SELECT COUNT(*) FROM {table} WHERE user_id = ?", (src_id,))
        count = cur.fetchone()[0]
        if count:
            cur.execute(f"UPDATE {table} SET user_id = ? WHERE user_id = ?", (dst_id, src_id))
            print(f"  Moved {count} rows in {table}")
        else:
            print(f"  No rows in {table}")

    conn.commit()
    conn.close()
    print("Done.")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python migrate_user.py <from_email> <to_email>")
        sys.exit(1)
    migrate("workout.db", sys.argv[1], sys.argv[2])
