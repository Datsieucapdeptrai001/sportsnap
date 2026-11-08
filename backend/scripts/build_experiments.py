"""Rebuild Insights using only the committed notebook CSV exports (no inference)."""

import argparse
import csv
import json
from pathlib import Path

from PIL import Image, ImageDraw


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as source:
        return list(csv.DictReader(source))


def split_metrics(rows: list[dict[str, str]], labels: list[str], split: str) -> dict[str, object]:
    indices = {label: index for index, label in enumerate(labels)}
    matrix = [[0 for _ in labels] for _ in labels]
    for row in rows:
        matrix[indices[row["thuc_te"]]][indices[row["du_doan"]]] += 1
    correct = sum(matrix[i][i] for i in range(len(labels)))
    f1: list[float] = []
    for i in range(len(labels)):
        denominator = sum(matrix[i]) + sum(row[i] for row in matrix)
        f1.append(2 * matrix[i][i] / denominator if denominator else 0.0)
    confusions = [
        {"true": labels[i], "pred": labels[j], "count": matrix[i][j]}
        for i in range(len(labels)) for j in range(len(labels)) if i != j and matrix[i][j]
    ]
    confusions.sort(key=lambda pair: (-int(pair["count"]), str(pair["true"]), str(pair["pred"])))
    return {
        "split": split, "count": len(rows), "accuracy": correct / len(rows),
        "macro_f1": sum(f1) / len(labels), "labels": labels, "confusion_matrix": matrix,
        "top_confusions": confusions[:10],
    }


def build_experiments(summary_path: Path, predictions_path: Path, labels_path: Path) -> dict[str, object]:
    summary = read_csv(summary_path)
    predictions = read_csv(predictions_path)
    labels: list[str] = json.loads(labels_path.read_text(encoding="utf-8"))
    if not summary or not predictions or not labels or len(set(labels)) != len(labels):
        raise ValueError("Non-empty summary, predictions and unique training labels are required.")
    # Notebook selects best_model by validation accuracy, not test accuracy.
    best_accuracy = max(float(row["Val Accuracy"]) for row in summary)
    winners = [row["Mô hình"] for row in summary if float(row["Val Accuracy"]) == best_accuracy]
    if len(winners) != 1:
        raise ValueError("CSV attribution is ambiguous: validation must identify a unique best_model.")
    selected = winners[0]
    for row in predictions:
        if row["split"] not in {"train", "valid", "test"}:
            raise ValueError("Unexpected split in prediction export.")
        if row["thuc_te"] not in labels or row["du_doan"] not in labels:
            raise ValueError("CSV label does not match unchanged labels.json.")
        if (row["thuc_te"] == row["du_doan"]) != (row["dung"].lower() == "true"):
            raise ValueError("CSV correctness flag disagrees with actual and predicted labels.")
    if len({row["file"] for row in predictions}) != len(predictions):
        raise ValueError("Duplicate image paths in prediction export.")
    splits = [
        split_metrics([row for row in predictions if row["split"] == split], labels, split)
        for split in ("train", "valid", "test") if any(row["split"] == split for row in predictions)
    ]
    test = next((item for item in splits if item["split"] == "test"), None)
    strategies = {
        "CNN_Scratch": "Huấn luyện từ đầu",
        "MobileNetV2": "Học chuyển giao và fine-tune",
        "ResNet50": "Học chuyển giao và fine-tune",
    }
    models = [{
        "name": row["Mô hình"], "strategy": strategies[row["Mô hình"]],
        "accuracy": float(row["Test Accuracy"]), "val_accuracy": float(row["Val Accuracy"]),
        "macro_f1": test["macro_f1"] if test and row["Mô hình"] == selected else None,
        "params_m": None, "size_mb": None, "latency_ms": None,
    } for row in summary]
    return {
        "models": models, "selected_model": selected, "splits": splits,
        "confusion_matrix_image": "cm.png" if test else None, "gradcam_gallery": [],
        "sources": {"comparison": summary_path.name, "predictions": predictions_path.name,
                    "attribution": "Notebook: predict_all(best_model); best_model chọn theo Val Accuracy cao nhất."},
        "notes": [
            "Accuracy/validation trong bảng lấy từ summary.csv; macro-F1 và ma trận từng split tính từ CSV dự đoán của mô hình được chọn.",
            "CSV dự đoán chỉ có mô hình được chọn; macro-F1 của các mô hình còn lại chưa đo. Số tham số, kích thước và latency không có trong CSV nên để null.",
            "Split train là dữ liệu huấn luyện, không dùng để đánh giá khả năng tổng quát hóa. Macro-F1 tính trên toàn bộ nhãn huấn luyện; lớp không có mẫu có F1 = 0.",
            "Chưa có ảnh Grad-CAM xuất từ notebook để lập thư viện; dùng nút Xem vùng AI chú ý trong trang Quét để phân tích ảnh của bạn.",
        ],
    }


def write_matrix_image(matrix: list[list[int]], path: Path) -> None:
    """Small companion PNG; the UI renders a labeled, accessible matrix itself."""
    cell = 24
    image = Image.new("RGB", (len(matrix) * cell, len(matrix) * cell), "white")
    draw = ImageDraw.Draw(image)
    maximum = max(max(row) for row in matrix) or 1
    for i, row in enumerate(matrix):
        for j, count in enumerate(row):
            strength = count / maximum
            color = (int(240 - 220 * strength), int(253 - 100 * strength), int(250 - 140 * strength))
            draw.rectangle((j * cell, i * cell, (j + 1) * cell - 1, (i + 1) * cell - 1), fill=color)
            draw.text((j * cell + 3, i * cell + 5), str(count), fill="black")
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="PNG")


def main() -> None:
    backend = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--summary", type=Path, default=backend / "data/summary.csv")
    parser.add_argument("--predictions", type=Path, default=backend / "data/ket_qua_du_doan_tat_ca_anh.csv")
    parser.add_argument("--labels", type=Path, default=backend / "models/labels.json")
    parser.add_argument("--output", type=Path, default=backend / "data/experiments.json")
    args = parser.parse_args()
    data = build_experiments(args.summary, args.predictions, args.labels)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    test = next((item for item in data["splits"] if item["split"] == "test"), None)
    if test:
        write_matrix_image(test["confusion_matrix"], args.output.parent / "insights/cm.png")


if __name__ == "__main__":
    main()
