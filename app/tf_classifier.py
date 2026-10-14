import tensorflow as tf
import numpy as np

# Simulasi sederhana validator kueri berbasis TensorFlow
def is_valid_query(text: str) -> bool:
    """
    Memeriksa panjang dan struktur teks sederhana.
    Bisa dikembangkan menjadi model klasifikasi teks penuh.
    """
    if not text or len(text.strip()) < 3:
        return False
    
    # Contoh pemrosesan tensor sederhana
    inputs = tf.constant([text])
    length = tf.strings.length(inputs)
    
    # Jika panjang karakter minimal 3, anggap kueri valid
    return bool(length.numpy()[0] >= 3)