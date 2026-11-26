"""Generate one native-text PDF for testing Chinese heading and body roles.

Run with Python 3 and ReportLab. The default output is tests/fixtures/role-heading.pdf.
All text is synthetic. Coordinates and point sizes are fixed for regression tests.
"""

import argparse
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfgen import canvas


FONT = "STSong-Light"
LEFT = 72
ROWS = (
    (766, 16, "第一章 绪论"),
    (728, 12, "本研究以三组模拟观测记录为例，说明课堂反馈的排序方法。"),
    (708, 12, "各组按照同一流程记录现象，并在讨论前填写独立观察表。"),
    (688, 12, "观察表分别列出任务、回答与复核结果，供小组成员逐项确认。"),
    (668, 12, "每一轮活动均使用相同材料，讲解与记录安排在不同时间。"),
    (648, 12, "局部差异以原来的记录位置为准，不把两组的回答合并计算。"),
    (608, 14, "（一）研究对象"),
    (572, 12, "课堂观察围绕同一项演示展开，记录表逐项写明提问和回应。"),
    (552, 12, "每次讨论结束后，由两位复核者独立核对观察记录。"),
    (532, 12, "复核意见分别保留，并在下一轮开始前与小组成员确认。"),
    (512, 12, "当记录存在缺项时，只标明缺失位置并回看对应片段。"),
    (492, 12, "归档时按观测顺序排列材料，每一条记录均保留原有编号。"),
    (472, 10.5, "这行正文说明复核过程，教师先看原表，再核对讨论中的记录。"),
    (452, 10.5, "（一）研究对象包括三组参与者，所有小组均按同一流程记录。"),
    (432, 10.5, "（二）两组均采用同一观察表"),
)


def write_pdf(output: Path) -> None:
    pdfmetrics.registerFont(UnicodeCIDFont(FONT))
    document = canvas.Canvas(str(output), pagesize=A4, invariant=True, pageCompression=1)
    document.setTitle("PDF heading role regression fixture")
    document.setAuthor("Synthetic fixture")
    for baseline, size, text in ROWS:
        document.setFont(FONT, size)
        document.drawString(LEFT, baseline, text)
    document.showPage()
    document.save()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "output", type=Path, nargs="?",
        default=Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "role-heading.pdf",
    )
    write_pdf(parser.parse_args().output)
