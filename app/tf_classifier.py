def is_valid_query(text: str) -> bool:
    """
    Memvalidasi teks query sebelum diproses oleh RAG engine.

    Aturan validasi:
    - Teks tidak boleh kosong atau None
    - Panjang minimal 3 karakter setelah strip whitespace
    - Tidak boleh hanya berisi karakter spasi atau tanda baca

    Catatan: Implementasi ini menggantikan versi berbasis TensorFlow
    sebelumnya untuk mengurangi ukuran Docker image (~400-600 MB).
    Logika validasi identik secara fungsional.
    """
    if not text:
        return False

    stripped = text.strip()
    if len(stripped) < 3:
        return False

    # Pastikan ada setidaknya satu karakter alfanumerik
    return any(c.isalnum() for c in stripped)