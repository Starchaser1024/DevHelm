from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


def test_dev_quickstart_verify_only_is_idempotent_in_temp_dir(tmp_path: Path) -> None:
    project_root = Path(__file__).resolve().parents[3]
    script_path = project_root / "scripts" / "dev_quickstart.py"
    db_file = tmp_path / "quickstart_verify.db"

    first = subprocess.run(
        [sys.executable, str(script_path), "--db-path", str(db_file), "--verify-only"],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    assert first.returncode == 0, f"stdout={first.stdout}\nstderr={first.stderr}"
    assert db_file.exists()

    first_payload = json.loads(first.stdout.strip().splitlines()[-1])
    assert first_payload["verification"]["status"] == "verified"
    assert first_payload["verification"]["full_name"] == "devhelm-labs/sample-service"
    assert first_payload["verification"]["issues"] == 3
    assert first_payload["verification"]["pull_requests"] == 2
    assert first_payload["verification"]["rag_chunks"] >= 5
    assert first_payload["verification"]["eval_id"]

    # Re-running against the same SQLite database must be idempotent
    second = subprocess.run(
        [sys.executable, str(script_path), "--db-path", str(db_file), "--verify-only"],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    assert second.returncode == 0, f"stdout={second.stdout}\nstderr={second.stderr}"
    second_payload = json.loads(second.stdout.strip().splitlines()[-1])
    assert second_payload["seeded"]["repo_id"] == first_payload["seeded"]["repo_id"]
    assert second_payload["seeded"]["issues"] == 3
    assert second_payload["seeded"]["pull_requests"] == 2
