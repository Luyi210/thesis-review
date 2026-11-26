"""Train a small PDF heading classifier on prepared DocLayNet geometry."""

import argparse
import json
from pathlib import Path

import numpy as np
from sklearn.ensemble import GradientBoostingClassifier


def counts(labels, predicted):
    true = int(np.count_nonzero(labels & predicted))
    false = int(np.count_nonzero(~labels & predicted))
    return {
        "lines": len(labels),
        "headings": int(labels.sum()),
        "true_positives": true,
        "false_positives": false,
        "precision": true / (true + false) if true + false else None,
        "recall": true / labels.sum() if labels.any() else None,
    }


def export_model(classifier, threshold):
    prior = float(classifier.init_.class_prior_[1])
    trees = []
    for estimator in classifier.estimators_[:, 0]:
        tree = estimator.tree_
        trees.append([
            [int(tree.feature[i]), float(tree.threshold[i]), int(tree.children_left[i]), int(tree.children_right[i])]
            if tree.children_left[i] >= 0 else [float(tree.value[i, 0, 0] * classifier.learning_rate)]
            for i in range(tree.node_count)
        ])
    return {"format": 1, "offset": float(np.log(prior / (1 - prior))), "threshold": threshold, "trees": trees}


def probability(package, features):
    # Same array format as the TypeScript evaluator. Check the exported values
    # against sklearn before writing the model.
    score = package["offset"]
    for tree in package["trees"]:
        node = tree[0]
        while len(node) == 4:
            feature, boundary, left, right = node
            node = tree[left if features[feature] <= boundary else right]
        score += node[0]
    return 1 / (1 + np.exp(-score))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("lines", type=Path)
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--report", required=True, type=Path)
    args = parser.parse_args()

    data = np.loadtxt(args.lines, delimiter=",", ndmin=2, dtype=np.float32)
    splits = data[:, 0].astype(int)
    labels = data[:, 1].astype(bool)
    eligible = data[:, 2].astype(bool)
    features = data[:, 3:]
    train, validation, test = [splits == split for split in range(3)]
    for name, split in zip(("train", "validation", "test"), (train, validation, test)):
        if len(set(labels[split])) != 2:
            raise ValueError(f"Both roles must be present in {name}")

    classifier = GradientBoostingClassifier(
        n_estimators=90, max_depth=4, min_samples_leaf=25,
        subsample=.8, learning_rate=.13, random_state=39,
    )
    print(f"Fitting {int(train.sum())} lines from public training pages", flush=True)
    classifier.fit(features[train], labels[train])
    val_scores = classifier.predict_proba(features[validation])[:, 1]
    val_labels = labels[validation]
    threshold = None
    # Prefer a conservative operating point based on validation alone.
    for candidate in np.arange(.50, .991, .01):
        metrics = counts(val_labels, val_scores >= candidate)
        if metrics["true_positives"] >= 25 and metrics["precision"] >= .90:
            threshold = round(float(candidate), 2)
            break
    if threshold is None:
        raise ValueError("No useful high-precision operating point on validation")

    model = export_model(classifier, threshold)
    test_rows = features[test]
    test_scores = classifier.predict_proba(test_rows)[:, 1]
    if not np.allclose([probability(model, row) for row in test_rows[:1200]], test_scores[:1200]):
        raise ValueError("Exported tree predictions differ from sklearn")
    report = {
        "task": "DocLayNet text line Title / Section-header versus other text-bearing roles",
        "training_lines": int(train.sum()),
        "training_headings": int(labels[train].sum()),
        "threshold": threshold,
        "validation": counts(val_labels, val_scores >= threshold),
        "test": counts(labels[test], test_scores >= threshold),
        "test_short_numbered_lines": counts(labels[test][eligible[test]], test_scores[eligible[test]] >= threshold),
    }
    args.report.write_text(json.dumps(report, indent=2) + "\n")
    if report["test"]["precision"] is None or report["test"]["precision"] < .80:
        raise ValueError("Held-out corpus precision is too low for integration")
    args.model.write_text(json.dumps(model, separators=(",", ":")) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
