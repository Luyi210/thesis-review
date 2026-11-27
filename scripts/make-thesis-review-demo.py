#!/usr/bin/env python3
"""Build the synthetic thesis-review fixture with a fixed simulation seed."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from random import Random
from statistics import mean
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from docx import Document
from docx.enum.section import WD_SECTION_START
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT, WD_TAB_LEADER
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Mm, Pt, RGBColor
from PIL import Image, ImageDraw, ImageFont

TITLE = "高校图书馆自习座位使用效率研究"
ENGLISH_TITLE = "Study Seat Use in a Campus Library"
SEED = 68473
SONGTI = "宋体"
HEITI = "黑体"
LATIN = "Liberation Serif"

CHAPTERS = [
    "第一章 绪论",
    "第二章 文献综述与理论基础",
    "第三章 研究设计",
    "第四章 研究分析",
    "第五章 结论与建议",
]
HEADINGS = [
    ["第一节 研究背景与问题", "第二节 概念与研究范围"],
    ["第一节 既有研究的两种统计口径", "第二节 本文的分析框架"],
    ["第一节 观察单元与模拟数据", "第二节 指标与比较方案"],
    ["第一节 分时段占用表现"],
    ["第一节 结论", "第二节 局限与后续验证"],
]


def east_asian_font(style_or_run, name=SONGTI, size=12, bold=False):
    font = style_or_run.font
    font.name = LATIN
    font.size = Pt(size)
    font.bold = bold
    font.color.rgb = RGBColor(0, 0, 0)
    rpr = style_or_run.element.get_or_add_rPr()
    fonts = rpr.find(qn("w:rFonts"))
    for theme_name in ("asciiTheme", "hAnsiTheme", "eastAsiaTheme", "cstheme", "csTheme"):
        fonts.attrib.pop(qn("w:" + theme_name), None)
    fonts.set(qn("w:eastAsia"), name)


def set_style(style, *, size=12, bold=False, after=0, before=0, line=20, indent=0):
    east_asian_font(style, size=size, bold=bold)
    fmt = style.paragraph_format
    fmt.space_before = Pt(before)
    fmt.space_after = Pt(after)
    fmt.line_spacing = Pt(line)
    fmt.first_line_indent = Pt(indent)


def build_styles(doc):
    style = doc.styles
    set_style(style["Normal"], after=8, indent=24)
    style["Normal"].paragraph_format.widow_control = True
    set_style(style["Title"], size=24, bold=True, line=32, after=14)
    set_style(style["Heading 1"], size=18, bold=True, line=27, after=14)
    set_style(style["Heading 2"], size=14, bold=True, line=23, before=11, after=6)
    set_style(style["Caption"], size=10.5, line=16, before=3, after=5)
    set_style(style["Footer"], size=10, line=14)
    for name in ("Front Note", "Notice", "Reference Entry", "Figure Image", "TOC1", "TOC2", "Table Cell"):
        if name not in style:
            style.add_style(name, WD_STYLE_TYPE.PARAGRAPH)
        style[name].base_style = style["Normal"]
    set_style(style["Front Note"], line=20, after=9)
    set_style(style["Notice"], size=10.5, line=16, after=5)
    set_style(style["Reference Entry"], size=11, line=18, after=5)
    set_style(style["Figure Image"], line=20, before=2, after=4)
    style["Figure Image"].paragraph_format.line_spacing = 1
    set_style(style["TOC1"], size=12, bold=True, line=19, before=4, after=1)
    set_style(style["TOC2"], size=11, line=17, after=1)
    style["TOC2"].paragraph_format.left_indent = Pt(22)
    for name in ("TOC1", "TOC2"):
        style[name].paragraph_format.tab_stops.add_tab_stop(Cm(15.8), WD_TAB_ALIGNMENT.RIGHT, WD_TAB_LEADER.DOTS)
    set_style(style["Table Cell"], size=10, line=15)
    for name in ("Title", "Heading 1", "Heading 2"):
        props = style[name].element.get_or_add_pPr()
        for item in props.findall(qn("w:pBdr")):
            props.remove(item)


def paper(section, *, width=210, height=297):
    section.page_width = Mm(width)
    section.page_height = Mm(height)
    section.top_margin = Mm(24)
    section.bottom_margin = Mm(22)
    section.left_margin = Mm(26)
    section.right_margin = Mm(26)
    section.footer_distance = Mm(11)


def footer(doc):
    section = doc.sections[0]
    section.different_first_page_header_footer = True
    p = section.footer.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = p.add_run()
    field = OxmlElement("w:fldSimple")
    field.set(qn("w:instr"), "PAGE")
    value = OxmlElement("w:r")
    text = OxmlElement("w:t")
    text.text = "1"
    value.append(text)
    field.append(value)
    run._r.addnext(field)


def marker(doc, text):
    p = doc.add_paragraph(text, "Notice")
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    return p


def chapter(doc, index, new_page=True):
    p = doc.add_heading(CHAPTERS[index], 1)
    p.paragraph_format.page_break_before = new_page
    return p


def subhead(doc, chapter_index, index):
    doc.add_heading(HEADINGS[chapter_index][index], 2)


def body(doc, text, *, line=None):
    p = doc.add_paragraph(text)
    if line is not None:
        p.paragraph_format.line_spacing = Pt(line)
    return p


def caption(doc, text, *, keep_with_next=False):
    p = doc.add_paragraph(text, "Caption")
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.keep_with_next = keep_with_next
    return p


def picture(doc, data, alt, *, keep_with_next=False):
    p = doc.add_paragraph(style="Figure Image")
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.keep_with_next = keep_with_next
    shape = p.add_run().add_picture(BytesIO(data), width=Cm(13.3))
    shape._inline.docPr.set("descr", alt)


def simulation():
    rng = Random(SEED)
    windows = ("09:00", "13:00", "19:00")
    areas = {"A": 24, "B": 36, "C": 32}
    rates = {"A": (.43, .51, .82), "B": (.60, .70, .94), "C": (.42, .55, .78)}
    draws = {
        name: [
            [round(max(0, min(1, rng.gauss(level, .065))) * capacity) for _ in range(10)]
            for level in rates[name]
        ]
        for name, capacity in areas.items()
    }
    means = {
        name: [round(mean(values) / capacity * 100) for values in draws[name]]
        for name, capacity in areas.items()
    }
    full_evenings = {name: sum(n == capacity for n in draws[name][2]) for name, capacity in areas.items()}
    return windows, areas, means, full_evenings


def chart_font(size):
    # DejaVu Sans is Pillow's usual fallback. Arial is available in this environment.
    for name in ("DejaVuSans.ttf", "/System/Library/Fonts/Supplemental/Arial.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)


def chart(windows, means, full_evenings=None):
    width, height = 1240, 340
    im = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(im)
    font = chart_font(27)
    small = chart_font(23)
    dark, gray, line = "#182632", "#51606D", "#D8DEE2"
    colors = {"A": "#335B74", "B": "#6D8795", "C": "#A2B2B9"}
    left, right, top, bottom = 126, 1168, 24, 250
    if full_evenings is None:
        max_value, ticks = 100, (0, 25, 50, 75, 100)
        x_labels = windows
        group_values = [[means[name][i] for name in means] for i in range(3)]
    else:
        max_value, ticks = 10, (0, 2, 4, 6, 8, 10)
        x_labels = ("Area A", "Area B", "Area C")
        group_values = [[full_evenings[name]] for name in means]
    draw.line((left, bottom, right, bottom), fill=gray, width=2)
    for tick in ticks:
        y = bottom - round((bottom - top) * tick / max_value)
        draw.line((left, y, right, y), fill=line, width=2)
        draw.text((left - 15, y), f"{tick}%" if max_value == 100 else str(tick), font=small, fill=gray, anchor="rm")
    spacing = (right - left) / 3
    for i, (label, group) in enumerate(zip(x_labels, group_values)):
        center = int(left + (i + .5) * spacing)
        draw.text((center, 264), label, font=font, fill=dark, anchor="mt")
        for j, value in enumerate(group):
            key = "ABC"[j if max_value == 100 else i]
            x = center + (j - (len(group) - 1) / 2) * 72
            y = bottom - round((bottom - top) * value / max_value)
            if value:
                draw.rectangle((int(x - 26), y, int(x + 26), bottom), fill=colors[key])
            if max_value != 100:
                draw.text((x, y - 8), str(value), font=small, fill=dark, anchor="mb")
    if max_value == 100:
        for i, (name, color) in enumerate(colors.items()):
            x = 442 + i * 146
            draw.rectangle((x, 306, x + 24, 328), fill=color)
            draw.text((x + 32, 317), "Area " + name, font=small, fill=gray, anchor="lm")
    else:
        draw.text((width // 2, 319), "Fully occupied sessions out of 10", font=small, fill=gray, anchor="mm")
    buffer = BytesIO()
    im.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def observation_table(doc, windows, areas, means, full_evenings):
    rows = [
        ["区域", "有效席位", *(f"{value} 占用率" for value in windows), "晚间满座次数"],
        *[[name, str(areas[name]), *(f"{v}%" for v in means[name]), f"{full_evenings[name]} / 10"] for name in areas],
    ]
    table = doc.add_table(rows=len(rows), cols=len(rows[0]))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    widths = [1.45, 1.75, 2.95, 2.95, 2.95, 2.55]
    for column, width in zip(table.columns, widths):
        column.width = Cm(width)
    pr = table._tbl.tblPr
    borders = OxmlElement("w:tblBorders")
    for side in ("top", "left", "bottom", "right", "insideH", "insideV"):
        b = OxmlElement("w:" + side)
        b.set(qn("w:val"), "single")
        b.set(qn("w:sz"), "5")
        b.set(qn("w:color"), "D9D9D9")
        borders.append(b)
    pr.append(borders)
    margins = OxmlElement("w:tblCellMar")
    for side in ("top", "left", "bottom", "right"):
        edge = OxmlElement("w:" + side)
        edge.set(qn("w:w"), "80")
        edge.set(qn("w:type"), "dxa")
        margins.append(edge)
    pr.append(margins)
    for row_index, values in enumerate(rows):
        row = table.rows[row_index]
        properties = row._tr.get_or_add_trPr()
        properties.append(OxmlElement("w:cantSplit"))
        if row_index == 0:
            properties.append(OxmlElement("w:tblHeader"))
        for cell, width, value in zip(row.cells, widths, values):
            cell.width = Cm(width)
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            p = cell.paragraphs[0]
            p.style = "Table Cell"
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            run = p.add_run(value)
            if row_index == 0:
                run.bold = True
                shade = OxmlElement("w:shd")
                shade.set(qn("w:fill"), "EEF2F4")
                cell._tc.get_or_add_tcPr().append(shade)


def front_matter(doc):
    title = doc.add_paragraph(TITLE, "Title")
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    title.paragraph_format.space_before = Pt(112)
    p = doc.add_paragraph(ENGLISH_TITLE, "Front Note")
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(23)
    marker(doc, "合成演示稿").runs[0].bold = True
    marker(doc, "论文审核工作台 预答辩阶段")
    marker(doc, "场景与数据均为模拟，仅供格式审阅演示")

    p = doc.add_heading("摘要", 1)
    p.paragraph_format.page_break_before = True
    body(doc, "高校图书馆自习区可能在同一时段出现局部满座与剩余席位并存的现象。只看全馆总占用率，容易忽略分区容量、观测时间和席位状态对学生找座的影响。本文选取一个虚构图书馆作为场景，以三个自习区的分时段观测为例，说明如何记录有效席位、计算占用率并比较高峰压力。")
    body(doc, "本文固定随机种子生成十个模拟工作日的占用数据。每日在九点、十三点与十九点各安排一次快照。每次观测以区域内可使用席位数作为分母，以正在使用的席位数作为分子。先计算各区各时段的平均占用率，再单列晚间满座次数，避免只凭一个平均值判断高峰压力。记录表保留区域、时段和快照日期，便于重复计算。")
    body(doc, "模拟数据显示，三个区域的晚间占用率都高于各自上午的平均水平，其中资料服务区更早接近容量上限。用总平均展示需求时，有必要同时报告满座次数和分区分母。本文提出在布置指引前先检查座位状态，并用现场观察验证模拟中出现的分区差异。图表只说明统计方法与格式审阅场景。")
    p = doc.add_paragraph("关键词：图书馆；自习座位；占用率；分时观测；空间管理；模拟数据", "Front Note")
    p.runs[0].bold = True
    doc.add_paragraph("中图分类号：G258.6", "Front Note")

    p = doc.add_heading("Abstract", 1)
    p.paragraph_format.page_break_before = True
    for passage in [
        "A campus library can have available seats overall while a particular study area is already full. This demonstration compares three fictional areas and shows how time windows and the number of usable seats affect the interpretation of occupancy.",
        "A fixed random seed generates data for ten simulated weekdays. Each day includes snapshots at 09:00, 13:00 and 19:00. Mean occupancy is computed within each area and time window. Evening sessions at full capacity are recorded separately to preserve information lost in an average.",
        "In the simulation, evening use exceeds morning use across all three areas. The service area approaches capacity most often. The figures illustrate a reporting method. Field observations would be needed before applying the findings to a real library.",
    ]:
        p = doc.add_paragraph(passage, "Front Note")
        p.paragraph_format.space_after = Pt(14)
    doc.add_paragraph("Keywords: campus libraries, study seats, capacity, occupancy", "Front Note")
    doc.add_paragraph("CLC: G258.6", "Front Note")

    p = doc.add_heading("目录", 1)
    p.paragraph_format.page_break_before = True
    for index, label in enumerate(CHAPTERS):
        page = index + 5
        doc.add_paragraph(f"{label}\t{page}", "TOC1")
        for section in HEADINGS[index]:
            doc.add_paragraph(f"{section}\t{page}", "TOC2")
    doc.add_paragraph("参考文献\t9", "TOC1")


def write_body(doc, windows, areas, means, full_evenings):
    chapter(doc, 0)
    subhead(doc, 0, 0)
    p = body(doc, "")
    p.add_run("当多个自习区服务同一批读者时，")
    east_asian_font(p.add_run("座位供给的分时分布"), size=10.5)
    p.add_run("比简单总量更难观察。一处自习区接近满座，并不意味着其他区域也无法使用。记录分区差异，有助于在讨论增加座位前判断现有座位是否已经被均衡使用。")
    p = body(doc, "")
    p.add_run("本研究关注")
    east_asian_font(p.add_run("各区座位的分时占用"), size=10)
    p.add_run("，并把")
    east_asian_font(p.add_run("晚间接近满座的次数"), size=14)
    p.add_run("与平均占用率分开报告，以便识别两种指标各自能回答的问题。")
    p = body(doc, "")
    east_asian_font(p.add_run("研究场景设为一个虚构校园。"), name=HEITI)
    p.add_run("资料服务区位于入口附近，安静区和研讨区分列两侧。三处空间在容量和用途上有差异，因此统计时分别保留自己的分母。")
    subhead(doc, 0, 1)
    for text in [
        "本文把在观测时点可使用的座位记为有效席位。临时维修、计划保留或已改作通道的座位排除在分母之外。使用状态以观测时点的预设记录为准，便于区分位置、容量与使用强度。",
        "模拟中的一次快照代表一个区域在某个时点的总体状态。它可以用于比较早、中、晚的拥挤程度，无法独立给出个人停留时间或等候时长。若要回答这些问题，需要另设观测频率和记录规则。",
        "后续章节先说明占用率的分母和计量边界，再展示不同区域的模拟数据如何汇总。讨论始终围绕演示场景，未对任何实际学校或图书馆作评价。",
    ]:
        body(doc, text)

    chapter(doc, 1)
    subhead(doc, 1, 0)
    for text in [
        "空间评估通常需要同时明确观察对象和统计窗口。按座位统计可以比较分区容量，按区域统计便于快速展示时间变化。当三个区域的座位数不同，直接平均三个百分比会改变每个座位的权重，因此两种平均应分别解释。",
        "利用率与座位周转也回答不同的问题。快照占用率描述记录时点有多少座位被使用，周转则需要连续记录使用开始和结束。本文的模拟仅提供快照，所以对周转效率保留讨论边界。",
        "示例文献[1]用于演示如何交代有效席位的纳入条件，[2]用于演示如何在一张表中保留时段和区域信息。两条条目均由本稿虚构，作为参考文献结构练习。",
    ]:
        body(doc, text)
    subhead(doc, 1, 1)
    body(doc, "本稿先核对分区容量，再在每个区内比较时段占用，最后用晚间满座次数补充平均情况。只要观察口径清楚，就能根据同一批模拟数值重复得到相同结果。", line=17)
    p = body(doc, "")
    p.add_run("在展示阶段，")
    marked = p.add_run("按区域和时段分别排序")
    tracking = OxmlElement("w:spacing")
    tracking.set(qn("w:val"), "18")
    marked._r.get_or_add_rPr().append(tracking)
    p.add_run("，读者可以追溯异常是出现在容量不同的区域之间，还是出现在同一区域的不同时间。")
    body(doc, "若需要解释为什么读者选择某一处，还应记录插座、距离、噪声等条件。这里的模拟只改变占用概率，讨论集中于如何观察与报告分区差异。")

    chapter(doc, 2)
    subhead(doc, 2, 0)
    body(doc, "观察覆盖十个模拟工作日，固定九点、十三点和十九点三个取样时点。各区域的有效席位在模拟期内保持不变，每次记录按区域保存占用席位整数。使用相同随机种子可重建这组演示数据。")
    body(doc, "区域 A 为安静自习区，区域 B 为资料服务区，区域 C 为研讨区。各区按本区有效席位数计算占用率。表内为十次同一时点快照的平均占用率，四舍五入到整数。")
    observation_table(doc, windows, areas, means, full_evenings)
    caption(doc, "表 3-1 各区域容量与分时占用汇总")
    subhead(doc, 2, 1)
    for text in [
        "一次快照的占用率为正在使用的席位数除以有效席位数。同一区域、同一时点的十个占用率使用算术平均。同一班次内的未观测状态不作推算。",
        "仅在晚间快照中，当占用席位数与有效席位数相等时，记为一次满座。满座次数与平均占用率分别计算，便于区分典型水平与容量上限。",
        "比较的主要单位是区域和时点。总量可以用于描述整体供给规模，但区域用途和容纳人数不同，不能据此直接判断某一空间在实际运营中是否需要扩建。",
    ]:
        body(doc, text)

    chapter(doc, 3)
    subhead(doc, 3, 0)
    body(doc, "图中的每组柱对应一次固定取样时点。对照早、中、晚三个时点可以看到，区域差异在晚间更明显。分区色块沿用同一排序，便于与上一章表格对应。")
    caption(doc, "图 4-1 三个时段的平均占用率", keep_with_next=True)
    picture(doc, chart(windows, means), "三个时段各区域平均占用率的分组柱状图。数据为模拟。")
    body(doc, f"三个区域的晚间平均占用率分别为 {means['A'][2]}%、{means['B'][2]}% 和 {means['C'][2]}%。资料服务区的平均值最高，共有 {full_evenings['B']} 次晚间快照达到满座。")
    picture(doc, chart(windows, means, full_evenings), "十次晚间模拟快照中三个区域各自的满座次数。", keep_with_next=True)
    caption(doc, "图 4-1 各区域晚间满座次数")
    body(doc, "平均占用率适合描述总体水平，满座次数则指向使用者可能遇到的容量限制。两者一起呈现，能让教师复核数据表达是否与讨论文字一致。")

    section = doc.add_section(WD_SECTION_START.NEW_PAGE)
    section.different_first_page_header_footer = False
    paper(section, width=215.9, height=279.4)
    chapter(doc, 4, new_page=False)
    subhead(doc, 4, 0)
    body(doc, "合成数据展示了同馆不同区域在相同时段的拥挤差异。若只把三个区加总，资料服务区的高占用会被其他区域的可用席位部分抵消。使用区域层面的占用率和满座次数，更容易暴露需要进一步观察的时间窗口。")
    body(doc, "在真正投入现场观察前，可先统一记录表中的席位定义，划分区域界线，并让不同观察者用相同时间点记录。之后再根据实际观测决定是否试运行分区指引。")
    subhead(doc, 4, 1)
    body(doc, "模拟只覆盖十个工作日且不记录个体行为，没有纳入考试周、活动或天气变化。后续可记录实际的座位状态变动，并通过重复观察检验不同时间窗中的满座现象。")
    doc.add_heading("参考文献", 1)
    for entry in [
        "[1] 合成文献甲. 虚构校园图书馆席位观察与记录示例[R]. 演示文献集, 2025.",
        "[2] 合成文献乙. 分时段座位快照汇总方法示例[J]. 演示文献集, 2025(2): 12-18.",
        "[3] 合成文献丙. 自习空间容量指标解释示例[M]. 演示文献集, 2026.",
    ]:
        doc.add_paragraph(entry, "Reference Entry")
    doc.add_paragraph("参考文献为合成条目，用于展示稿件结构。", "Notice")


def save_deterministic(doc, dest):
    stream = BytesIO()
    doc.save(stream)
    with ZipFile(stream) as src, ZipFile(dest, "w", compression=ZIP_DEFLATED, compresslevel=9) as out:
        for entry in sorted(src.namelist()):
            info = ZipInfo(entry, (2026, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            out.writestr(info, src.read(entry))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path(__file__).with_name("thesis-review-demo.docx"))
    args = parser.parse_args()
    doc = Document()
    paper(doc.sections[0])
    build_styles(doc)
    footer(doc)
    props = doc.core_properties
    props.title = TITLE
    props.subject = "论文审核工作台合成样稿"
    props.author = "论文审核工作台合成样稿"
    props.last_modified_by = props.author
    props.comments = "Synthetic format-check demonstration with deterministic data."
    props.created = props.modified = datetime(2026, 1, 1, tzinfo=timezone.utc)
    front_matter(doc)
    write_body(doc, *simulation())
    save_deterministic(doc, args.output)


if __name__ == "__main__":
    main()
