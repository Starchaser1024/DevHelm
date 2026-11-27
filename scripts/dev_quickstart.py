#!/usr/bin/env python3
"""Cross-platform zero-Docker local quickstart runner for DevHelm."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = PROJECT_ROOT / "backend"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Initialize a local SQLite DevHelm workspace with demo data and verify or start the API server."
    )
    parser.add_argument(
        "--db-path",
        default="./devhelm_local.db",
        help="Path to the local SQLite database file (default: ./devhelm_local.db).",
    )
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Host interface for uvicorn (default: 127.0.0.1).",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8000,
        help="Port for uvicorn (default: 8000).",
    )
    parser.add_argument(
        "--reload",
        action="store_true",
        help="Enable uvicorn auto-reload in development.",
    )
    parser.add_argument(
        "--use-configured-llm",
        action="store_true",
        help="Keep configured LLM_API_KEY / RAG_LLM_ENABLED / RAGAS_ENABLED instead of offline deterministic mode.",
    )
    parser.add_argument(
        "--verify-only",
        action="store_true",
        help="Run in-process health, repository, RAG, and PR readiness evaluation checks then exit 0.",
    )
    return parser


def configure_environment(db_path: Path, *, use_configured_llm: bool) -> tuple[Path, str]:
    resolved_db = db_path.expanduser()
    if not resolved_db.is_absolute():
        resolved_db = (Path.cwd() / resolved_db).resolve()
    else:
        resolved_db = resolved_db.resolve()

    resolved_db.parent.mkdir(parents=True, exist_ok=True)
    data_dir = resolved_db.parent / ".data"
    (data_dir / "uploads").mkdir(parents=True, exist_ok=True)
    (data_dir / "repos").mkdir(parents=True, exist_ok=True)

    database_url = f"sqlite:///{resolved_db.as_posix()}"
    os.environ["DATABASE_URL"] = database_url
    os.environ["MILVUS_ENABLED"] = "false"
    os.environ["EMBEDDING_PROVIDER"] = "deterministic"
    os.environ["EMBEDDING_MODEL"] = "deterministic-demo"
    os.environ["EMBEDDING_DIMENSIONS"] = "128"
    os.environ["AUTO_SYNC_ENABLED"] = "false"
    os.environ["DEMO_MODE"] = "true"
    os.environ["UPLOAD_DIR"] = str(data_dir / "uploads")
    os.environ["REPO_CHECKOUT_DIR"] = str(data_dir / "repos")

    if not use_configured_llm:
        os.environ["LLM_API_KEY"] = ""
        os.environ["RAG_LLM_ENABLED"] = "false"
        os.environ["RAGAS_ENABLED"] = "false"
        os.environ["RERANK_API_KEY"] = ""
        os.environ["RERANK_BASE_URL"] = ""

    return resolved_db, database_url


def run_verify_checks(expected_repo_full_name: str) -> dict[str, object]:
    from fastapi.testclient import TestClient

    from app.main import create_app

    app = create_app()
    with TestClient(app) as client:
        health_resp = client.get("/health")
        if health_resp.status_code != 200 or health_resp.json().get("status") != "ok":
            raise RuntimeError(f"Health check failed: {health_resp.status_code} {health_resp.text}")

        repos_resp = client.get("/api/repos")
        if repos_resp.status_code != 200:
            raise RuntimeError(f"/api/repos failed: {repos_resp.status_code} {repos_resp.text}")
        repos = repos_resp.json()
        demo_repo = next((item for item in repos if item.get("full_name") == expected_repo_full_name), None)
        if demo_repo is None:
            raise RuntimeError(f"Demo repository {expected_repo_full_name} not found in /api/repos")

        repo_id = demo_repo["id"]

        issues_resp = client.get(f"/api/repos/{repo_id}/issues")
        if issues_resp.status_code != 200 or not issues_resp.json():
            raise RuntimeError(f"Demo issues check failed: {issues_resp.status_code} {issues_resp.text}")

        prs_resp = client.get(f"/api/repos/{repo_id}/pull-requests")
        if prs_resp.status_code != 200 or not prs_resp.json():
            raise RuntimeError(f"Demo pull requests check failed: {prs_resp.status_code} {prs_resp.text}")

        rag_resp = client.get(f"/api/rag/repositories/{repo_id}")
        if rag_resp.status_code != 200 or int(rag_resp.json().get("chunk_count") or 0) <= 0:
            raise RuntimeError(f"Demo RAG check failed: {rag_resp.status_code} {rag_resp.text}")

        eval_resp = client.post("/api/evals/pr-readiness/run", json={"repo_id": repo_id})
        if eval_resp.status_code != 200:
            raise RuntimeError(
                f"/api/evals/pr-readiness/run failed: {eval_resp.status_code} {eval_resp.text}"
            )
        eval_body = eval_resp.json()
        if eval_body.get("status") != "completed":
            raise RuntimeError(f"Unexpected eval status: {eval_body}")

        return {
            "status": "verified",
            "repo_id": repo_id,
            "full_name": expected_repo_full_name,
            "issues": len(issues_resp.json()),
            "pull_requests": len(prs_resp.json()),
            "rag_chunks": rag_resp.json()["chunk_count"],
            "eval_id": eval_body.get("eval_id"),
            "eval_summary": (eval_body.get("result") or {}).get("summary") or {},
        }


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    resolved_db, database_url = configure_environment(
        Path(args.db_path),
        use_configured_llm=args.use_configured_llm,
    )

    for candidate in (BACKEND_DIR, PROJECT_ROOT):
        if str(candidate) not in sys.path:
            sys.path.insert(0, str(candidate))

    from app.db.bootstrap import ensure_schema_compatibility
    from app.db.session import engine
    from scripts.seed_demo_data import DEMO_REPO_FULL_NAME, seed_demo_data

    ensure_schema_compatibility(engine)
    seeded = seed_demo_data(data_root=resolved_db.parent / ".data" / "uploads")

    if args.verify_only:
        verification = run_verify_checks(DEMO_REPO_FULL_NAME)
        print(
            json.dumps(
                {
                    "database_url": database_url,
                    "seeded": seeded,
                    "verification": verification,
                },
                ensure_ascii=False,
            )
        )
        engine.dispose()
        return 0

    mode_label = "configured-llm" if args.use_configured_llm else "offline-deterministic (degraded RAG)"
    print("DevHelm zero-Docker local quickstart ready:")
    print(f"  Database : {resolved_db}")
    print(f"  Mode     : {mode_label}")
    print(f"  Demo Repo: {seeded['full_name']} ({seeded['repo_id']})")
    print(f"  API URL  : http://{args.host}:{args.port}")
    print(f"  OpenAPI  : http://{args.host}:{args.port}/docs")
    print(f"  Frontend : cd frontend && NEXT_PUBLIC_API_BASE_URL=http://{args.host}:{args.port} npm run dev")

    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        app_dir=str(BACKEND_DIR),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
