# -*- coding: utf-8 -*-
"""
Chạy lại phần đánh giá ẢNH NGOÀI BỘ DỮ LIỆU cho báo cáo SportSnap (Bảng 5.12 và Bảng 4.2).

Mã tính toán chép nguyên từ hai notebook của nhóm, không thay đổi cách tính:
  - Phần A (Bảng 5.12): ô 12.4 trong SportSnap_02_ThiNghiem_BoSung_Muc12.ipynb
      Top-1 / Top-5 của MobileNetV2 và ResNet50 trên toàn bộ thư mục anh-ngoai.
  - Phần B (Bảng 4.2): hàm predict_image (TTA lật ngang) trong detaimoi.final.ipynb,
      chạy MobileNetV2 trên 1 ảnh test/baseball/2.jpg và 15 ảnh đầu của anh-ngoai.

Cách chạy (PowerShell, dùng môi trường Python đã cài TensorFlow của backend):
  D:\\fork\\sportsnap\\backend\\.venv\\Scripts\\python.exe chay_lai_anh_ngoai.py --models "THƯ_MỤC_CHỨA_2_FILE_KERAS"

Kết quả in ra màn hình và lưu vào ket_qua_anh_ngoai.txt cạnh file script này.
"""
import argparse, glob, os, sys, datetime
import numpy as np
import tensorflow as tf
from tensorflow.keras.applications.mobilenet_v2 import preprocess_input as mnv2_preprocess
from tensorflow.keras.applications.resnet50 import preprocess_input as resnet_preprocess

ap = argparse.ArgumentParser()
ap.add_argument("--models", required=True, help="Thư mục chứa MobileNetV2_finetune_best.keras và ResNet50_finetune_best.keras")
ap.add_argument("--project", default=r"D:\fork\sportsnap", help="Thư mục project sportsnap")
args = ap.parse_args()

EXT_DIR = os.path.join(args.project, "datasets", "anh-ngoai")
TEST_IMG = os.path.join(args.project, "datasets", "sports-classification", "test", "baseball", "2.jpg")
IMG_SIZE = (224, 224)
VALID_IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".webp", ".bmp")
CLASS_NAMES = sorted([
    "archery", "baseball", "basketball", "boxing", "canoe slamon", "field hockey",
    "figure skating women", "football", "formula 1 racing", "golf", "high jump", "hockey",
    "olympic wrestling", "polo", "roller derby", "rollerblade racing", "swimming", "tennis",
    "uneven bars", "volleyball",
])

out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ket_qua_anh_ngoai.txt")
log = open(out_path, "w", encoding="utf-8")
def say(*a):
    s = " ".join(str(x) for x in a)
    print(s); log.write(s + "\n"); log.flush()

say("Thời điểm chạy:", datetime.datetime.now().isoformat(timespec="seconds"))
say("TensorFlow:", tf.__version__, "| Python:", sys.version.split()[0])
say("EXT_DIR:", EXT_DIR)
assert os.path.isdir(EXT_DIR), "Không thấy thư mục anh-ngoai"

def load(fn):
    p = os.path.join(args.models, fn)
    assert os.path.exists(p), f"Không thấy {p}"
    say(f"Nạp {fn} ({os.path.getsize(p)/1e6:.1f} MB)")
    return tf.keras.models.load_model(p, compile=False)

mobilenet_model = load("MobileNetV2_finetune_best.keras")
resnet_model = load("ResNet50_finetune_best.keras")

# ---------------- Phần A: Top-1 / Top-5 (ô 12.4) ----------------
say("\n===== PHẦN A: Top-1 / Top-5 trên ảnh ngoài (Bảng 5.12) =====")
for model_name, m, pre_fn in [("MobileNetV2", mobilenet_model, mnv2_preprocess),
                              ("ResNet50", resnet_model, resnet_preprocess)]:
    top1 = top5 = n_ext = 0
    for i, c in enumerate(CLASS_NAMES):
        files = sorted(
            f for f in glob.glob(os.path.join(EXT_DIR, c, "*"))
            if f.lower().endswith(VALID_IMAGE_EXTS)
        )
        for f in files:
            img = tf.image.resize(
                tf.io.decode_image(tf.io.read_file(f), channels=3, expand_animations=False),
                IMG_SIZE,
            )
            x_in = tf.expand_dims(img, 0)
            if pre_fn is not None:
                x_in = pre_fn(x_in)
            pr = m.predict(x_in, verbose=0)[0]
            order = np.argsort(pr)[::-1]
            top1 += int(order[0] == i)
            top5 += int(i in order[:5])
            n_ext += 1
    say(f"==> Kết quả {model_name} trên ảnh ngoài (n = {n_ext}):")
    say(f"    - Top-1 Accuracy: {top1/max(n_ext,1):.3f} ({top1}/{n_ext})")
    say(f"    - Top-5 Accuracy: {top5/max(n_ext,1):.3f} ({top5}/{n_ext})")

# ---------------- Phần B: 16 ảnh, predict_image có TTA (Bảng 4.2) ----------------
def predict_image(path, model, preprocess_fn, class_names, top_k=3, tta=True):
    img = tf.keras.utils.load_img(path, target_size=IMG_SIZE)
    arr = tf.keras.utils.img_to_array(img)
    batch = np.stack([arr, arr[:, ::-1, :]]) if tta else np.expand_dims(arr, 0)
    x = preprocess_fn(batch.copy()) if preprocess_fn else batch
    probs = model.predict(x, verbose=0).mean(axis=0)
    idx = np.argsort(probs)[::-1][:top_k]
    return [(class_names[i], probs[i] * 100) for i in idx]

say("\n===== PHẦN B: 16 ảnh, MobileNetV2 + TTA lật ngang (Bảng 4.2) =====")
paths = [("test/baseball/2.jpg", TEST_IMG)]
all_image_paths = []
for root, _, files in os.walk(EXT_DIR):
    for fname in sorted(files):
        if fname.lower().endswith(VALID_IMAGE_EXTS):
            all_image_paths.append(os.path.join(root, fname))
for p in all_image_paths[:15]:
    paths.append((os.path.relpath(p, EXT_DIR).replace("\\", "/"), p))
for k, (rel, p) in enumerate(paths, 1):
    expected = rel.split("/")[-2]
    res = predict_image(p, mobilenet_model, mnv2_preprocess, CLASS_NAMES)
    ok = "Đúng" if res[0][0] == expected else "Sai"
    say(f"{k:>2}. {rel:<28} mong đợi={expected:<12} | "
        + " | ".join(f"{n} ({v:.1f}%)" for n, v in res) + f" | {ok}")

say("\nĐã lưu kết quả vào:", out_path)
log.close()
