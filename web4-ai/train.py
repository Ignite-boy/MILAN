"""Offline GRU trainer. Trains from genuine recorded viewing sequences only."""
import json
import os
import random
from datetime import datetime, timezone
from pathlib import Path
import torch
from torch import nn
from model import NextItemGRU

ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("MILAN_WEB4_DATA_DIR", str(Path.home() / ".local" / "share" / "milan-web4-ai"))).expanduser()
DATA_FILE = DATA_DIR / "sequences.json"
MODEL_PATH = Path(os.environ.get("MILAN_WEB4_MODEL_PATH", str(ROOT / "next_item_gru.pt"))).expanduser()
MAX_SEQ_LEN, EMBEDDING_DIM, HIDDEN_DIM = 16, 32, 64
EPOCHS, BATCH_SIZE = 12, 64
MIN_TRAIN_SAMPLES, MIN_VALIDATION_SAMPLES, MIN_UNIQUE_ITEMS = 30, 5, 5
random.seed(42)
torch.manual_seed(42)
torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))


def make_batches(samples, shuffle):
    ordered = list(samples)
    if shuffle:
        random.shuffle(ordered)
    for start in range(0, len(ordered), BATCH_SIZE):
        batch = ordered[start:start + BATCH_SIZE]
        lengths = torch.tensor([len(seq) for seq, _ in batch], dtype=torch.long)
        inputs = torch.zeros((len(batch), int(lengths.max().item())), dtype=torch.long)
        targets = torch.tensor([target for _, target in batch], dtype=torch.long)
        for i, (seq, _) in enumerate(batch):
            inputs[i, :len(seq)] = torch.tensor(seq, dtype=torch.long)
        yield inputs, lengths, targets


def evaluate(model, samples, loss_fn, vocab_size):
    model.eval()
    total_loss = top1 = top3 = total = 0
    with torch.inference_mode():
        for inputs, lengths, targets in make_batches(samples, False):
            logits = model(inputs, lengths)
            logits[:, 0] = -1e9
            loss = loss_fn(logits, targets)
            total_loss += float(loss.item()) * len(targets)
            indices = logits.topk(k=min(3, vocab_size - 1), dim=-1).indices
            top1 += int((indices[:, 0] == targets).sum().item())
            top3 += int((indices == targets.unsqueeze(1)).any(dim=1).sum().item())
            total += len(targets)
    return {"loss": round(total_loss / max(total, 1), 6),
            "top1_accuracy": round(top1 / max(total, 1), 4),
            "top3_accuracy": round(top3 / max(total, 1), 4),
            "validation_samples": total}


def main():
    if not DATA_FILE.exists():
        print("TRAINING SKIPPED: no real viewing-sequence file exists yet.")
        print("Expected data file:", DATA_FILE)
        return 2
    try:
        raw = json.loads(DATA_FILE.read_text(encoding="utf-8"))
        raw_sequences = raw.get("sequences", {})
    except (OSError, ValueError) as exc:
        print("TRAINING SKIPPED: sequence store could not be read:", exc)
        return 2
    if not isinstance(raw_sequences, dict):
        print("TRAINING SKIPPED: invalid sequence-store format.")
        return 2
    sequences = []
    for items in raw_sequences.values():
        if not isinstance(items, list):
            continue
        cleaned = [item for item in items if isinstance(item, str) and item.strip()]
        if len(cleaned) >= 3:
            sequences.append(cleaned[-MAX_SEQ_LEN - 1:])
    all_items = sorted({item for seq in sequences for item in seq})
    if len(all_items) < MIN_UNIQUE_ITEMS:
        print(f"TRAINING SKIPPED: need at least {MIN_UNIQUE_ITEMS} unique records; found {len(all_items)}.")
        return 2

    vocab = {item: index + 1 for index, item in enumerate(all_items)}
    training, validation = [], []
    for seq in sequences:
        ids = [vocab[item] for item in seq]
        n = len(ids)
        if n >= 4:
            for target_pos in range(2, n - 1):
                training.append((ids[max(0, target_pos - MAX_SEQ_LEN):target_pos], ids[target_pos]))
            validation.append((ids[max(0, n - 1 - MAX_SEQ_LEN):n - 1], ids[-1]))
        elif n == 3:
            training.append((ids[:2], ids[2]))
    print("Unique record IDs:", len(vocab))
    print("Training samples:", len(training))
    print("Validation samples:", len(validation))
    if len(training) < MIN_TRAIN_SAMPLES:
        print("TRAINING SKIPPED: not enough genuine training transitions.")
        return 2
    if len(validation) < MIN_VALIDATION_SAMPLES:
        print("TRAINING SKIPPED: not enough held-out validation transitions.")
        return 2

    model = NextItemGRU(len(vocab) + 1, EMBEDDING_DIM, HIDDEN_DIM)
    optimizer, loss_fn = torch.optim.Adam(model.parameters(), lr=0.001), nn.CrossEntropyLoss()
    best_metric, best_state, best_metrics = (-1.0, -1.0), None, None
    for epoch in range(EPOCHS):
        model.train()
        total_loss = total = 0
        for inputs, lengths, targets in make_batches(training, True):
            optimizer.zero_grad()
            logits = model(inputs, lengths)
            logits[:, 0] = -1e9
            loss = loss_fn(logits, targets)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            total_loss += float(loss.item()) * len(targets)
            total += len(targets)
        metrics = evaluate(model, validation, loss_fn, len(vocab) + 1)
        print(f"Epoch {epoch + 1:02d}/{EPOCHS} train_loss={total_loss / max(total, 1):.4f} "
              f"val_top1={metrics['top1_accuracy']:.3f} val_top3={metrics['top3_accuracy']:.3f}")
        metric = (metrics["top3_accuracy"], metrics["top1_accuracy"])
        if metric > best_metric:
            best_metric = metric
            best_state = {key: value.detach().cpu().clone() for key, value in model.state_dict().items()}
            best_metrics = metrics

    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = MODEL_PATH.with_suffix(".pt.tmp")
    torch.save({"format_version": 1, "trained_at": datetime.now(timezone.utc).isoformat(),
                "vocab": vocab, "max_sequence_length": MAX_SEQ_LEN,
                "model_config": {"embedding_dim": EMBEDDING_DIM, "hidden_dim": HIDDEN_DIM},
                "state_dict": best_state, "metrics": best_metrics}, temporary_path)
    os.replace(temporary_path, MODEL_PATH)
    print("MODEL SAVED:", MODEL_PATH)
    print("BEST VALIDATION METRICS:", json.dumps(best_metrics))
    print("Compare against the Markov baseline before claiming production improvement.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
