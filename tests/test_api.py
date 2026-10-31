import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_root_endpoint():
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data.get("status") == "online"
    assert "AI Knowledge Base API" in data.get("message", "")

def test_upload_unsupported_file_extension():
    response = client.post(
        "/upload",
        files={"file": ("unsupported_file.exe", b"binary content", "application/octet-stream")}
    )
    assert response.status_code == 400
    assert "Hanya file dengan format PDF, TXT, DOCX, atau CSV" in response.json().get("detail", "")

def test_upload_file_size_exceeded():
    large_content = b"a" * (5 * 1024 * 1024 + 1024)  # 5 MB + 1 KB
    response = client.post(
        "/upload",
        files={"file": ("large_document.txt", large_content, "text/plain")}
    )
    assert response.status_code == 413
    assert "melebihi batas maksimal" in response.json().get("detail", "")

def test_query_invalid_question():
    response = client.post(
        "/query",
        json={"question": "??"}
    )
    assert response.status_code == 400
    assert "Pertanyaan tidak valid" in response.json().get("detail", "")

def test_documents_with_thread_id_filter():
    response = client.get("/documents?thread_id=non_existent_thread_xyz")
    assert response.status_code == 200
    data = response.json()
    assert data.get("status") == "success"
    assert data.get("thread_id") == "non_existent_thread_xyz"
    assert data.get("total") == 0

def test_query_empty_thread_documents():
    response = client.post(
        "/query",
        json={"question": "Apa isi dokumen ini?", "thread_id": "empty_thread_999"}
    )
    assert response.status_code == 200
    data = response.json()
    assert "Belum ada dokumen yang diunggah untuk thread ini" in data.get("answer", "")

