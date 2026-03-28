import sys
import json
import os

from PySide6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QDialog, QTabWidget,
    QSplitter, QLabel, QPushButton, QLineEdit, QCheckBox, QComboBox,
    QTextEdit, QFrame, QVBoxLayout, QHBoxLayout, QGridLayout, QFormLayout,
    QDialogButtonBox, QMessageBox, QFileDialog, QInputDialog,
    QStatusBar, QAbstractItemView, QSizePolicy, QSpinBox
)
from PySide6.QtCore import Qt, Signal, QPoint
from PySide6.QtGui import QAction, QKeySequence, QShortcut, QFont
# QTreeWidget / QTreeWidgetItem
from PySide6.QtWidgets import QTreeWidget, QTreeWidgetItem


# ---------------------------------------------------------------------------
# DataManager
# ---------------------------------------------------------------------------
class DataManager:
    def __init__(self):
        self.filepath = None
        self.data = {}
        self.is_modified = False
        self._parent_widget = None  # set by app for error dialogs

    def load_file(self, filepath):
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                self.data = json.load(f)
            self.filepath = filepath
            self._ensure_structure()
            self.is_modified = False
            return True
        except Exception as e:
            _silent_critical(self._parent_widget, "エラー",
                             f"ファイルの読み込みに失敗しました:\n{e}")
            return False

    def save_file(self, filepath=None):
        target = filepath if filepath else self.filepath
        if not target:
            return False
        try:
            with open(target, "w", encoding="utf-8") as f:
                json.dump(self.data, f, ensure_ascii=False, indent=2)
            self.filepath = target
            self.is_modified = False
            return True
        except Exception as e:
            _silent_critical(self._parent_widget, "エラー",
                             f"ファイルの保存に失敗しました:\n{e}")
            return False

    def _ensure_structure(self):
        if not isinstance(self.data, dict):
            self.data = {}
        if "passed" not in self.data:
            self.data["passed"] = []
        elif isinstance(self.data["passed"], list) and len(self.data["passed"]) > 0:
            if "system" not in self.data["passed"][0]:
                old = self.data["passed"]
                self.data["passed"] = [{"system": "Call of Cthulhu", "groups": old}]
                self.is_modified = True
        if "planned_schedule" not in self.data:
            self.data["planned_schedule"] = {}
        ps = self.data["planned_schedule"]
        if "note" not in ps:
            ps["note"] = ""
        if "months" not in ps:
            ps["months"] = []
        if "watched" not in self.data:
            self.data["watched"] = []
        if "gm" not in self.data:
            self.data["gm"] = []

    def get_passed_systems(self):
        return self.data.get("passed", [])

    def get_watched_systems(self):
        return self.data.get("watched", [])

    def get_gm_systems(self):
        return self.data.get("gm", [])

    def get_planned_data(self):
        return self.data.get("planned_schedule", {})

    def mark_modified(self):
        self.is_modified = True


# ---------------------------------------------------------------------------
# DnDTreeWidget — shared drag-and-drop treewidget
# ---------------------------------------------------------------------------
class DnDTreeWidget(QTreeWidget):
    """QTreeWidget with custom ghost-label drag-and-drop."""
    dnd_dropped = Signal(object, object)  # (source_item, target_item)

    def __init__(self, columns, parent=None):
        super().__init__(parent)
        self.setColumnCount(len(columns))
        self.setHeaderLabels(columns)
        self.setSelectionMode(QAbstractItemView.SingleSelection)
        self._drag_source = None
        self._drag_start = None
        self._ghost = None

    def mousePressEvent(self, event):
        if event.button() == Qt.LeftButton:
            item = self.itemAt(event.pos())
            if item:
                self._drag_source = item
                self._drag_start = event.pos()
        super().mousePressEvent(event)

    def mouseMoveEvent(self, event):
        if self._drag_source and self._drag_start is not None:
            dist = (event.pos() - self._drag_start).manhattanLength()
            if dist > 5:
                if self._ghost is None:
                    self._ghost = QLabel(self._drag_source.text(0))
                    self._ghost.setWindowFlags(
                        Qt.ToolTip | Qt.FramelessWindowHint)
                    self._ghost.setStyleSheet(
                        "background:#d0d8ff;border:1px solid #6688cc;"
                        "padding:3px;")
                    self._ghost.show()
                self._ghost.move(
                    event.globalPosition().toPoint() + QPoint(12, 12))
            target = self.itemAt(event.pos())
            if target:
                self.setCurrentItem(target)
        super().mouseMoveEvent(event)

    def mouseReleaseEvent(self, event):
        if self._ghost:
            self._ghost.close()
            self._ghost = None
        if self._drag_source:
            target = self.itemAt(event.pos())
            if target and target is not self._drag_source:
                self.dnd_dropped.emit(self._drag_source, target)
            self._drag_source = None
            self._drag_start = None
        super().mouseReleaseEvent(event)


# ---------------------------------------------------------------------------
# Helper: data stored in tree items
# ---------------------------------------------------------------------------
_ROLE = Qt.UserRole


def _idata(item):
    return item.data(0, _ROLE)


def _sdata(item, d):
    item.setData(0, _ROLE, d)


# ---------------------------------------------------------------------------
# Dialogs
# ---------------------------------------------------------------------------
def _cancel_ok_box(dlg, ok_cb):
    box = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
    box.button(QDialogButtonBox.Cancel).setText("キャンセル")
    box.accepted.connect(ok_cb)
    box.rejected.connect(dlg.reject)
    return box


class BulkItemDialog(QDialog):
    def __init__(self, parent=None, row_count=10):
        super().__init__(parent)
        self.setWindowTitle("まとめて追加")
        self.setMinimumWidth(420)
        self.result_data = []
        self.rows = []
        lay = QGridLayout(self)
        for col, txt in enumerate(["タイトル", "HO", "お気に入り", "推しHO"]):
            lay.addWidget(QLabel(txt), 0, col)
        for i in range(row_count):
            te = QLineEdit(); he = QLineEdit()
            fc = QCheckBox(); fhc = QCheckBox()
            lay.addWidget(te,  i+1, 0)
            lay.addWidget(he,  i+1, 1)
            lay.addWidget(fc,  i+1, 2)
            lay.addWidget(fhc, i+1, 3)
            self.rows.append((te, he, fc, fhc))
        lay.addWidget(_cancel_ok_box(self, self._ok), row_count+1, 0, 1, 4)

    def _ok(self):
        self.result_data = []
        for te, he, fc, fhc in self.rows:
            t = te.text().strip()
            if t:
                self.result_data.append({
                    "title": t, "ho": he.text().strip(),
                    "favorite": fc.isChecked(), "favorite_ho": fhc.isChecked()
                })
        self.accept()


class WatchedBulkItemDialog(QDialog):
    def __init__(self, parent=None, row_count=10):
        super().__init__(parent)
        self.setWindowTitle("まとめて追加（視聴）")
        self.setMinimumWidth(420)
        self.result_data = []
        self.rows = []
        lay = QGridLayout(self)
        for col, txt in enumerate(["タイトル", "お気に入り"]):
            lay.addWidget(QLabel(txt), 0, col)
        for i in range(row_count):
            te = QLineEdit(); fc = QCheckBox()
            lay.addWidget(te, i+1, 0)
            lay.addWidget(fc, i+1, 1)
            self.rows.append((te, fc))
        lay.addWidget(_cancel_ok_box(self, self._ok), row_count+1, 0, 1, 2)

    def _ok(self):
        self.result_data = []
        for te, fc in self.rows:
            t = te.text().strip()
            if t:
                self.result_data.append({"title": t, "favorite": fc.isChecked()})
        self.accept()


class GMBulkItemDialog(QDialog):
    def __init__(self, parent=None, row_count=10):
        super().__init__(parent)
        self.setWindowTitle("まとめて追加（GM）")
        self.setMinimumWidth(420)
        self.result_data = []
        self.rows = []
        lay = QGridLayout(self)
        for col, txt in enumerate(["タイトル", "回数"]):
            lay.addWidget(QLabel(txt), 0, col)
        for i in range(row_count):
            te = QLineEdit()
            ce = QSpinBox()
            ce.setRange(0, 999)
            ce.setValue(1)
            lay.addWidget(te, i+1, 0)
            lay.addWidget(ce, i+1, 1)
            self.rows.append((te, ce))
        lay.addWidget(_cancel_ok_box(self, self._ok), row_count+1, 0, 1, 2)

    def _ok(self):
        self.result_data = []
        for te, ce in self.rows:
            t = te.text().strip()
            if t:
                self.result_data.append({"title": t, "count": str(ce.value())})
        self.accept()


class ItemDialog(QDialog):
    def __init__(self, parent=None, title="", ho="",
                 favorite=False, favorite_ho=False):
        super().__init__(parent)
        self.setWindowTitle("アイテム編集")
        self.setMinimumWidth(420)
        self.result_data = None
        lay = QFormLayout(self)
        self.title_e = QLineEdit(title)
        self.title_e.setMinimumWidth(260)
        self.ho_e = QLineEdit(ho)
        self.fav_c = QCheckBox(); self.fav_c.setChecked(favorite)
        self.favho_c = QCheckBox(); self.favho_c.setChecked(favorite_ho)
        lay.addRow("タイトル:", self.title_e)
        lay.addRow("HO:", self.ho_e)
        lay.addRow("お気に入り:", self.fav_c)
        lay.addRow("推しHO:", self.favho_c)
        lay.addRow(_cancel_ok_box(self, self._ok))

    def _ok(self):
        if not self.title_e.text().strip():
            _silent_warning(self, "警告", "タイトルは必須です。")
            return
        self.result_data = {
            "title": self.title_e.text().strip(),
            "ho": self.ho_e.text().strip(),
            "favorite": self.fav_c.isChecked(),
            "favorite_ho": self.favho_c.isChecked()
        }
        self.accept()


class WatchedItemDialog(QDialog):
    def __init__(self, parent=None, title="", favorite=False):
        super().__init__(parent)
        self.setWindowTitle("アイテム編集（視聴）")
        self.setMinimumWidth(420)
        self.result_data = None
        lay = QFormLayout(self)
        self.title_e = QLineEdit(title)
        self.title_e.setMinimumWidth(260)
        self.fav_c = QCheckBox(); self.fav_c.setChecked(favorite)
        lay.addRow("タイトル:", self.title_e)
        lay.addRow("お気に入り:", self.fav_c)
        lay.addRow(_cancel_ok_box(self, self._ok))

    def _ok(self):
        if not self.title_e.text().strip():
            _silent_warning(self, "警告", "タイトルは必須です。")
            return
        self.result_data = {
            "title": self.title_e.text().strip(),
            "favorite": self.fav_c.isChecked()
        }
        self.accept()


class GMItemDialog(QDialog):
    def __init__(self, parent=None, title="", count=""):
        super().__init__(parent)
        self.setWindowTitle("アイテム編集（GM）")
        self.setMinimumWidth(420)
        self.result_data = None
        lay = QFormLayout(self)
        self.title_e = QLineEdit(title)
        self.title_e.setMinimumWidth(260)
        self.count_spin = QSpinBox()
        self.count_spin.setRange(0, 999)
        try:
            self.count_spin.setValue(int(count))
        except (ValueError, TypeError):
            self.count_spin.setValue(0)
        lay.addRow("タイトル:", self.title_e)
        lay.addRow("回数:", self.count_spin)
        lay.addRow(_cancel_ok_box(self, self._ok))

    def _ok(self):
        if not self.title_e.text().strip():
            _silent_warning(self, "警告", "タイトルは必須です。")
            return
        self.result_data = {
            "title": self.title_e.text().strip(),
            "count": str(self.count_spin.value())
        }
        self.accept()


class PlannedItemDialog(QDialog):
    def __init__(self, parent=None, title="", role=""):
        super().__init__(parent)
        self.setWindowTitle("予定アイテム編集")
        self.setMinimumWidth(420)
        self.result_data = None
        lay = QFormLayout(self)
        self.title_e = QLineEdit(title)
        self.title_e.setMinimumWidth(260)
        self.role_e = QLineEdit(role)
        lay.addRow("タイトル:", self.title_e)
        lay.addRow("役割:", self.role_e)
        lay.addRow(_cancel_ok_box(self, self._ok))

    def _ok(self):
        if not self.title_e.text().strip():
            QMessageBox.warning(self, "警告", "タイトルは必須です。")
            return
        self.result_data = {
            "title": self.title_e.text().strip(),
            "role": self.role_e.text().strip()
        }
        self.accept()


class PlannedBulkItemDialog(QDialog):
    def __init__(self, parent=None, row_count=10):
        super().__init__(parent)
        self.setWindowTitle("まとめて追加（予定）")
        self.setMinimumWidth(420)
        self.result_data = []
        self.rows = []
        lay = QGridLayout(self)
        for col, txt in enumerate(["タイトル", "役割"]):
            lay.addWidget(QLabel(txt), 0, col)
        for i in range(row_count):
            te = QLineEdit()
            re = QLineEdit()
            te.setMinimumWidth(200)
            lay.addWidget(te, i+1, 0)
            lay.addWidget(re, i+1, 1)
            self.rows.append((te, re))
        lay.addWidget(_cancel_ok_box(self, self._ok), row_count+1, 0, 1, 2)

    def _ok(self):
        self.result_data = []
        for te, re in self.rows:
            t = te.text().strip()
            if t:
                self.result_data.append({
                    "title": t, "role": re.text().strip()
                })
        self.accept()


class MoveDialog(QDialog):
    def __init__(self, parent=None, groups=None, current_idx=0,
                 title_text="移動", label_text="移動先を選択:"):
        super().__init__(parent)
        self.setWindowTitle(title_text)
        self.result_index = None
        lay = QVBoxLayout(self)
        lay.addWidget(QLabel(label_text))
        self.combo = QComboBox()
        for g in (groups or []):
            self.combo.addItem(g.get("label", "No Label"))
        if groups and 0 <= current_idx < len(groups):
            self.combo.setCurrentIndex(current_idx)
        lay.addWidget(self.combo)
        box = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        box.button(QDialogButtonBox.Cancel).setText("キャンセル")
        box.accepted.connect(self._ok)
        box.rejected.connect(self.reject)
        lay.addWidget(box)

    def _ok(self):
        self.result_index = self.combo.currentIndex()
        self.accept()


# ---------------------------------------------------------------------------
# Shared helpers for tab widgets
# ---------------------------------------------------------------------------
def _mk_btn(text, cb):
    b = QPushButton(text)
    b.clicked.connect(cb)
    return b


def _hr():
    f = QFrame()
    f.setFrameShape(QFrame.HLine)
    f.setFrameShadow(QFrame.Sunken)
    return f


def _silent_info(parent, title, message):
    """音を鳴らさない情報ダイアログ（NoIcon を使用）"""
    msg = QMessageBox(parent)
    msg.setWindowTitle(title)
    msg.setText(message)
    msg.setIcon(QMessageBox.NoIcon)
    msg.setStandardButtons(QMessageBox.Ok)
    msg.exec()


def _silent_warning(parent, title, message):
    """音を鳴らさない警告ダイアログ（NoIcon を使用）"""
    msg = QMessageBox(parent)
    msg.setWindowTitle(title)
    msg.setText(message)
    msg.setIcon(QMessageBox.NoIcon)
    msg.setStandardButtons(QMessageBox.Ok)
    msg.exec()


def _silent_critical(parent, title, message):
    """音を鳴らさないエラーダイアログ（NoIcon を使用）"""
    msg = QMessageBox(parent)
    msg.setWindowTitle(title)
    msg.setText(message)
    msg.setIcon(QMessageBox.NoIcon)
    msg.setStandardButtons(QMessageBox.Ok)
    msg.exec()


def _silent_question(parent, title, message, buttons=QMessageBox.Yes | QMessageBox.No):
    """音を鳴らさない確認ダイアログ（NoIcon を使用）。戻り値は押されたボタン。"""
    msg = QMessageBox(parent)
    msg.setWindowTitle(title)
    msg.setText(message)
    msg.setIcon(QMessageBox.NoIcon)
    msg.setStandardButtons(buttons)
    return msg.exec()


# ---------------------------------------------------------------------------
# _SystemTabBase — common base for Passed / Watched / GM tabs
# ---------------------------------------------------------------------------
class _SystemTabBase(QWidget):
    """Abstract base for tabs that have system+group+item hierarchy."""

    # ---- override these in subclasses ----
    def _get_systems(self): raise NotImplementedError
    def _column_headers(self): raise NotImplementedError
    def _item_extra_values(self, item): return []       # extra column strings
    def _make_bulk_dialog(self): raise NotImplementedError
    def _make_edit_dialog(self, item_data): raise NotImplementedError

    def __init__(self, parent, data_manager):
        super().__init__(parent)
        self.data_manager = data_manager
        self.current_system_index = 0
        self._setup_ui()

    def _setup_ui(self):
        main_lay = QVBoxLayout(self)
        main_lay.setContentsMargins(5, 5, 5, 5)
        main_lay.setSpacing(2)

        # ---- system selector bar ----
        top = QWidget()
        top.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        tl = QHBoxLayout(top)
        tl.setContentsMargins(0, 2, 0, 2)
        tl.addWidget(QLabel("システム:"))
        self.system_combo = QComboBox()
        self.system_combo.currentIndexChanged.connect(self.on_system_change)
        tl.addWidget(self.system_combo, 1)
        tl.addWidget(_mk_btn("システムを追加", self.add_system))
        tl.addWidget(_mk_btn("名前変更", self.rename_system))
        tl.addWidget(_mk_btn("削除", self.delete_system))
        main_lay.addWidget(top)

        # ---- splitter ----
        splitter = QSplitter(Qt.Horizontal)
        self.tree = DnDTreeWidget(self._column_headers())
        self.tree.setColumnWidth(0, 280)
        self.tree.dnd_dropped.connect(self._move_item_dnd)
        self.tree.itemDoubleClicked.connect(lambda *_: self.edit_item())
        splitter.addWidget(self.tree)

        btn_w = QWidget()
        bl = QVBoxLayout(btn_w)
        bl.addWidget(QLabel("グループの操作"))
        bl.addWidget(_mk_btn("グループを追加", self.add_group))
        bl.addWidget(_mk_btn("グループ名を変更", self.rename_group))
        bl.addWidget(_mk_btn("グループを削除", self.delete_group))
        bl.addWidget(_hr())
        bl.addWidget(QLabel("アイテムの操作"))
        bl.addWidget(_mk_btn("アイテムを追加", self.add_item))
        bl.addWidget(_mk_btn("アイテムを追加（複数）", self.add_item_bulk))
        bl.addWidget(_mk_btn("アイテムを編集", self.edit_item))
        bl.addWidget(_mk_btn("削除", self.delete_item))
        bl.addWidget(_mk_btn("グループに移動", self.move_item_to_group))
        bl.addWidget(_hr())
        bl.addWidget(QLabel("並び替え"))
        bl.addWidget(_mk_btn("上へ", self.move_up))
        bl.addWidget(_mk_btn("下へ", self.move_down))
        bl.addStretch()
        splitter.addWidget(btn_w)
        splitter.setSizes([700, 200])
        main_lay.addWidget(splitter)

    # ---- data helpers ----
    def _get_current_groups(self):
        systems = self._get_systems()
        if 0 <= self.current_system_index < len(systems):
            sd = systems[self.current_system_index]
            sd.setdefault("groups", [])
            return sd["groups"]
        return None

    def _get_sel(self):
        sel = self.tree.selectedItems()
        if not sel:
            return None, None
        it = sel[0]
        return it, _idata(it)

    def _sel_group(self, idx):
        for i in range(self.tree.topLevelItemCount()):
            g = self.tree.topLevelItem(i)
            d = _idata(g)
            if d and d["type"] == "group" and d["index"] == idx:
                self.tree.setCurrentItem(g)
                return

    def _sel_item(self, g_idx, i_idx):
        for i in range(self.tree.topLevelItemCount()):
            g = self.tree.topLevelItem(i)
            d = _idata(g)
            if d and d["type"] == "group" and d["index"] == g_idx:
                for j in range(g.childCount()):
                    c = g.child(j)
                    cd = _idata(c)
                    if cd and cd["type"] == "item" and cd["i_index"] == i_idx:
                        self.tree.setCurrentItem(c)
                        return

    # ---- system operations ----
    def refresh_systems(self):
        systems = self._get_systems()
        self.system_combo.blockSignals(True)
        self.system_combo.clear()
        for s in systems:
            self.system_combo.addItem(s.get("system", "Unknown"))
        if systems:
            if self.current_system_index >= len(systems):
                self.current_system_index = 0
            self.system_combo.setCurrentIndex(self.current_system_index)
        self.system_combo.blockSignals(False)
        self.refresh()

    def on_system_change(self, idx):
        if idx >= 0:
            self.current_system_index = idx
            self.refresh()

    def add_system(self):
        name, ok = QInputDialog.getText(self, "システムを追加", "システム名:")
        if ok and name:
            systems = self._get_systems()
            systems.append({"system": name, "groups": []})
            self.current_system_index = len(systems) - 1
            self.data_manager.mark_modified()
            self.refresh_systems()

    def rename_system(self):
        systems = self._get_systems()
        if 0 <= self.current_system_index < len(systems):
            old = systems[self.current_system_index].get("system", "")
            name, ok = QInputDialog.getText(
                self, "システム名を変更", "新しい名前:", text=old)
            if ok and name:
                systems[self.current_system_index]["system"] = name
                self.data_manager.mark_modified()
                self.refresh_systems()

    def delete_system(self):
        systems = self._get_systems()
        if 0 <= self.current_system_index < len(systems):
            if _silent_question(
                    self, "確認",
                    "このシステムとすべてのグループ/アイテムを削除しますか?"
            ) == QMessageBox.Yes:
                systems.pop(self.current_system_index)
                if self.current_system_index > 0:
                    self.current_system_index -= 1
                self.data_manager.mark_modified()
                self.refresh_systems()

    # ---- group operations ----
    def add_group(self):
        groups = self._get_current_groups()
        if groups is None:
            return
        name, ok = QInputDialog.getText(
            self, "グループを追加", "グループのラベル:")
        if ok and name:
            groups.append({"label": name, "items": []})
            self.data_manager.mark_modified()
            self.refresh()

    def rename_group(self):
        groups = self._get_current_groups()
        if groups is None:
            return
        _, info = self._get_sel()
        if info and info["type"] == "group":
            old = groups[info["index"]].get("label", "")
            name, ok = QInputDialog.getText(
                self, "グループ名を変更", "新しいラベル:", text=old)
            if ok and name:
                groups[info["index"]]["label"] = name
                self.data_manager.mark_modified()
                self.refresh()

    def delete_group(self):
        groups = self._get_current_groups()
        if groups is None:
            return
        _, info = self._get_sel()
        if info and info["type"] == "group":
            if _silent_question(
                    self, "確認",
                    "このグループとすべてのアイテムを削除しますか?"
            ) == QMessageBox.Yes:
                groups.pop(info["index"])
                self.data_manager.mark_modified()
                self.refresh()

    # ---- item operations ----
    def add_item(self):
        """1アイテム追加"""
        groups = self._get_current_groups()
        if groups is None:
            return
        _, info = self._get_sel()
        if info and info["type"] == "group":
            g_idx, insert_idx = info["index"], None
        elif info and info["type"] == "item":
            g_idx, insert_idx = info["g_index"], info["i_index"]
        else:
            _silent_info(
                self, "情報", "グループまたはアイテムを選択してください。")
            return
        dlg = self._make_edit_dialog({})
        if dlg.exec() == QDialog.Accepted and dlg.result_data:
            if insert_idx is not None:
                groups[g_idx]["items"].insert(insert_idx, dlg.result_data)
            else:
                groups[g_idx]["items"].append(dlg.result_data)
            self.data_manager.mark_modified()
            self.refresh()
            if insert_idx is not None:
                self._sel_item(g_idx, insert_idx)
            else:
                self._sel_group(g_idx)

    def add_item_bulk(self):
        """10アイテムまとめて追加"""
        groups = self._get_current_groups()
        if groups is None:
            return
        _, info = self._get_sel()
        if info and info["type"] == "group":
            g_idx, insert_idx = info["index"], None
        elif info and info["type"] == "item":
            g_idx, insert_idx = info["g_index"], info["i_index"]
        else:
            _silent_info(
                self, "情報", "グループまたはアイテムを選択してください。")
            return
        dlg = self._make_bulk_dialog()
        if dlg.exec() == QDialog.Accepted and dlg.result_data:
            if insert_idx is not None:
                for i, it in enumerate(dlg.result_data):
                    groups[g_idx]["items"].insert(insert_idx + i, it)
            else:
                groups[g_idx]["items"].extend(dlg.result_data)
            self.data_manager.mark_modified()
            self.refresh()
            if insert_idx is not None:
                self._sel_item(g_idx, insert_idx)
            else:
                self._sel_group(g_idx)

    def edit_item(self):
        groups = self._get_current_groups()
        if groups is None:
            return
        _, info = self._get_sel()
        if info and info["type"] == "item":
            it = groups[info["g_index"]]["items"][info["i_index"]]
            dlg = self._make_edit_dialog(it)
            if dlg.exec() == QDialog.Accepted and dlg.result_data:
                it.update(dlg.result_data)
                self.data_manager.mark_modified()
                self.refresh()

    def delete_item(self):
        groups = self._get_current_groups()
        if groups is None:
            return
        _, info = self._get_sel()
        if info and info["type"] == "item":
            if _silent_question(
                    self, "確認", "このアイテムを削除しますか?"
            ) == QMessageBox.Yes:
                groups[info["g_index"]]["items"].pop(info["i_index"])
                self.data_manager.mark_modified()
                self.refresh()

    def move_item_to_group(self):
        groups = self._get_current_groups()
        if groups is None:
            return
        _, info = self._get_sel()
        if info and info["type"] == "item":
            dlg = MoveDialog(self, groups, info["g_index"],
                             "グループに移動", "移動先のグループを選択:")
            if (dlg.exec() == QDialog.Accepted
                    and dlg.result_index is not None
                    and dlg.result_index != info["g_index"]):
                moved = groups[info["g_index"]]["items"].pop(info["i_index"])
                groups[dlg.result_index]["items"].append(moved)
                self.data_manager.mark_modified()
                self.refresh()

    def move_up(self):
        groups = self._get_current_groups()
        if groups is None:
            return
        _, info = self._get_sel()
        if not info:
            return
        if info["type"] == "group":
            idx = info["index"]
            if idx > 0:
                groups[idx], groups[idx-1] = groups[idx-1], groups[idx]
                self.data_manager.mark_modified()
                self.refresh()
                self._sel_group(idx-1)
        elif info["type"] == "item":
            g, i = info["g_index"], info["i_index"]
            items = groups[g]["items"]
            if i > 0:
                items[i], items[i-1] = items[i-1], items[i]
                self.data_manager.mark_modified()
                self.refresh()
                self._sel_item(g, i-1)

    def move_down(self):
        groups = self._get_current_groups()
        if groups is None:
            return
        _, info = self._get_sel()
        if not info:
            return
        if info["type"] == "group":
            idx = info["index"]
            if idx < len(groups) - 1:
                groups[idx], groups[idx+1] = groups[idx+1], groups[idx]
                self.data_manager.mark_modified()
                self.refresh()
                self._sel_group(idx+1)
        elif info["type"] == "item":
            g, i = info["g_index"], info["i_index"]
            items = groups[g]["items"]
            if i < len(items) - 1:
                items[i], items[i+1] = items[i+1], items[i]
                self.data_manager.mark_modified()
                self.refresh()
                self._sel_item(g, i+1)

    # ---- refresh ----
    def refresh(self):
        self.tree.clear()
        groups = self._get_current_groups()
        if groups is None:
            return
        for g_idx, group in enumerate(groups):
            g_item = QTreeWidgetItem(
                [group.get("label", ""), *[""] * (len(self._column_headers()) - 1)])
            _sdata(g_item, {"type": "group", "index": g_idx})
            self.tree.addTopLevelItem(g_item)
            g_item.setExpanded(True)
            for i_idx, item in enumerate(group.get("items", [])):
                vals = self._item_extra_values(item)
                i_item = QTreeWidgetItem(
                    [item.get("title", ""), *vals])
                _sdata(i_item, {"type": "item",
                                "g_index": g_idx, "i_index": i_idx})
                g_item.addChild(i_item)

    # ---- DnD ----
    def _move_item_dnd(self, src, tgt):
        si = _idata(src)
        ti = _idata(tgt)
        if not si or not ti:
            return
        groups = self._get_current_groups()
        if groups is None:
            return

        if si["type"] == "group":
            if ti["type"] == "group":
                a, b = si["index"], ti["index"]
                g = groups.pop(a)
                if a < b:
                    b -= 1
                groups.insert(b, g)
                self.data_manager.mark_modified()
                self.refresh()
            return

        if si["type"] == "item":
            sg, si_i = si["g_index"], si["i_index"]
            item = groups[sg]["items"].pop(si_i)
            if ti["type"] == "group":
                groups[ti["index"]]["items"].append(item)
            elif ti["type"] == "item":
                tg, ti_i = ti["g_index"], ti["i_index"]
                if sg == tg and si_i < ti_i:
                    ti_i -= 1
                groups[tg]["items"].insert(ti_i, item)
            self.data_manager.mark_modified()
            self.refresh()


# ---------------------------------------------------------------------------
# PassedTab
# ---------------------------------------------------------------------------
class PassedTab(_SystemTabBase):
    def refresh(self):
        # 「未分類」グループが空の場合は自動削除する
        groups = self._get_current_groups()
        if groups is not None:
            to_remove = []
            for i, g in enumerate(groups):
                if g.get("label", "") == "未分類" and not g.get("items", []):
                    to_remove.append(i)
            if to_remove:
                for i in reversed(to_remove):
                    groups.pop(i)
                self.data_manager.mark_modified()
        super().refresh()

    def _get_systems(self):
        return self.data_manager.get_passed_systems()

    def _column_headers(self):
        return ["グループ / タイトル", "HO", "お気に入り", "推しHO"]

    def _item_extra_values(self, item):
        return [
            item.get("ho", ""),
            "★" if item.get("favorite") else "",
            "♥" if item.get("favorite_ho") else ""
        ]

    def _make_bulk_dialog(self):
        return BulkItemDialog(self)

    def _make_edit_dialog(self, item_data):
        return ItemDialog(self,
                          title=item_data.get("title", ""),
                          ho=item_data.get("ho", ""),
                          favorite=item_data.get("favorite", False),
                          favorite_ho=item_data.get("favorite_ho", False))


# ---------------------------------------------------------------------------
# WatchedTab
# ---------------------------------------------------------------------------
class WatchedTab(_SystemTabBase):
    def _get_systems(self):
        return self.data_manager.get_watched_systems()

    def _column_headers(self):
        return ["グループ / タイトル", "お気に入り"]

    def _item_extra_values(self, item):
        return ["★" if item.get("favorite") else ""]

    def _make_bulk_dialog(self):
        return WatchedBulkItemDialog(self)

    def _make_edit_dialog(self, item_data):
        return WatchedItemDialog(self,
                                 title=item_data.get("title", ""),
                                 favorite=item_data.get("favorite", False))


# ---------------------------------------------------------------------------
# GMTab
# ---------------------------------------------------------------------------
class GMTab(_SystemTabBase):
    def _get_systems(self):
        return self.data_manager.get_gm_systems()

    def _column_headers(self):
        return ["グループ / タイトル", "回数"]

    def _item_extra_values(self, item):
        return [item.get("count", "")]

    def _make_bulk_dialog(self):
        return GMBulkItemDialog(self)

    def _make_edit_dialog(self, item_data):
        return GMItemDialog(self,
                            title=item_data.get("title", ""),
                            count=item_data.get("count", ""))


# ---------------------------------------------------------------------------
# PlannedTab
# ---------------------------------------------------------------------------
class PlannedTab(QWidget):
    def __init__(self, parent, data_manager, passed_tab=None):
        super().__init__(parent)
        self.data_manager = data_manager
        self.passed_tab = passed_tab
        self._setup_ui()

    def _setup_ui(self):
        main_lay = QVBoxLayout(self)
        main_lay.setContentsMargins(5, 5, 5, 5)

        vsplit = QSplitter(Qt.Vertical)

        # ---- note ----
        note_box = QFrame()
        note_box.setFrameShape(QFrame.StyledPanel)
        nl = QVBoxLayout(note_box)
        nl.addWidget(QLabel("メモ"))
        self.note_edit = QTextEdit()
        self.note_edit.textChanged.connect(self._on_note_change)
        nl.addWidget(self.note_edit)
        vsplit.addWidget(note_box)

        # ---- tree + buttons ----
        bottom = QWidget()
        bl = QHBoxLayout(bottom)
        bl.setContentsMargins(0, 0, 0, 0)

        self.tree = DnDTreeWidget(["月 / タイトル", "役割"])
        self.tree.setColumnWidth(0, 280)
        self.tree.dnd_dropped.connect(self._move_item_dnd)
        self.tree.itemDoubleClicked.connect(lambda *_: self.edit_item())
        bl.addWidget(self.tree, 3)

        btn_w = QWidget()
        btl = QVBoxLayout(btn_w)
        btl.addWidget(QLabel("月の操作"))
        btl.addWidget(_mk_btn("月を追加", self.add_month))
        btl.addWidget(_mk_btn("月名を変更", self.rename_month))
        btl.addWidget(_mk_btn("月を削除", self.delete_month))
        btl.addWidget(_hr())
        btl.addWidget(QLabel("アイテムの操作"))
        btl.addWidget(_mk_btn("アイテムを追加", self.add_item))
        btl.addWidget(_mk_btn("アイテムを追加（複数）", self.add_item_bulk))
        btl.addWidget(_mk_btn("アイテムを編集", self.edit_item))
        btl.addWidget(_mk_btn("削除", self.delete_item))
        btl.addWidget(_mk_btn("月に移動", self.move_item_to_month))
        btl.addWidget(_mk_btn("現行中", self.move_to_current))
        btl.addWidget(_mk_btn("完了", self.complete_item))
        btl.addWidget(_hr())
        btl.addWidget(QLabel("並び替え"))
        btl.addWidget(_mk_btn("上へ", self.move_up))
        btl.addWidget(_mk_btn("下へ", self.move_down))
        btl.addStretch()
        bl.addWidget(btn_w, 1)

        vsplit.addWidget(bottom)
        vsplit.setSizes([150, 450])
        main_lay.addWidget(vsplit)

    # ---- note ----
    def _on_note_change(self):
        pd = self.data_manager.get_planned_data()
        pd["note"] = self.note_edit.toPlainText()
        self.data_manager.mark_modified()

    # ---- helpers ----
    def _months(self):
        return self.data_manager.get_planned_data().get("months", [])

    def _get_sel(self):
        sel = self.tree.selectedItems()
        if not sel:
            return None, None
        it = sel[0]
        return it, _idata(it)

    def _sel_month(self, idx):
        for i in range(self.tree.topLevelItemCount()):
            m = self.tree.topLevelItem(i)
            d = _idata(m)
            if d and d["type"] == "month" and d["index"] == idx:
                self.tree.setCurrentItem(m)
                return

    def _sel_item(self, m_idx, i_idx):
        for i in range(self.tree.topLevelItemCount()):
            m = self.tree.topLevelItem(i)
            d = _idata(m)
            if d and d["type"] == "month" and d["index"] == m_idx:
                for j in range(m.childCount()):
                    c = m.child(j)
                    cd = _idata(c)
                    if cd and cd["type"] == "item" and cd["i_index"] == i_idx:
                        self.tree.setCurrentItem(c)
                        return

    # ---- refresh ----
    def refresh(self):
        pd = self.data_manager.get_planned_data()
        self.note_edit.blockSignals(True)
        self.note_edit.setPlainText(pd.get("note", ""))
        self.note_edit.blockSignals(False)
        self._refresh_tree()

    def _refresh_tree(self):
        self.tree.clear()
        for m_idx, month in enumerate(self._months()):
            m_item = QTreeWidgetItem([month.get("label", ""), ""])
            _sdata(m_item, {"type": "month", "index": m_idx})
            self.tree.addTopLevelItem(m_item)
            m_item.setExpanded(True)
            for i_idx, item in enumerate(month.get("items", [])):
                i_item = QTreeWidgetItem(
                    [item.get("title", ""), item.get("role", "")])
                _sdata(i_item, {"type": "item",
                                "m_index": m_idx, "i_index": i_idx})
                m_item.addChild(i_item)

    # ---- month ops ----
    def add_month(self):
        name, ok = QInputDialog.getText(self, "月を追加", "月のラベル:")
        if ok and name:
            pd = self.data_manager.get_planned_data()
            pd["months"].append({"label": name, "items": []})
            self.data_manager.mark_modified()
            self._refresh_tree()

    def rename_month(self):
        _, info = self._get_sel()
        if info and info["type"] == "month":
            pd = self.data_manager.get_planned_data()
            old = pd["months"][info["index"]].get("label", "")
            name, ok = QInputDialog.getText(
                self, "月名を変更", "新しいラベル:", text=old)
            if ok and name:
                pd["months"][info["index"]]["label"] = name
                self.data_manager.mark_modified()
                self._refresh_tree()

    def delete_month(self):
        _, info = self._get_sel()
        if info and info["type"] == "month":
            if _silent_question(
                    self, "確認",
                    "この月とすべてのアイテムを削除しますか?"
            ) == QMessageBox.Yes:
                pd = self.data_manager.get_planned_data()
                pd["months"].pop(info["index"])
                self.data_manager.mark_modified()
                self._refresh_tree()

    # ---- item ops ----
    def add_item(self):
        """1アイテム追加"""
        _, info = self._get_sel()
        if info and info["type"] == "month":
            m_idx, insert_idx = info["index"], None
        elif info and info["type"] == "item":
            m_idx, insert_idx = info["m_index"], info["i_index"]
        else:
            _silent_info(self, "情報", "月またはアイテムを選択してください。")
            return
        dlg = PlannedItemDialog(self)
        if dlg.exec() == QDialog.Accepted and dlg.result_data:
            pd = self.data_manager.get_planned_data()
            if insert_idx is not None:
                pd["months"][m_idx]["items"].insert(insert_idx, dlg.result_data)
            else:
                pd["months"][m_idx]["items"].append(dlg.result_data)
            self.data_manager.mark_modified()
            self._refresh_tree()
            if insert_idx is not None:
                self._sel_item(m_idx, insert_idx)
            else:
                self._sel_month(m_idx)

    def add_item_bulk(self):
        """10アイテムまとめて追加"""
        _, info = self._get_sel()
        if info and info["type"] == "month":
            m_idx, insert_idx = info["index"], None
        elif info and info["type"] == "item":
            m_idx, insert_idx = info["m_index"], info["i_index"]
        else:
            _silent_info(self, "情報", "月またはアイテムを選択してください。")
            return
        dlg = PlannedBulkItemDialog(self)
        if dlg.exec() == QDialog.Accepted and dlg.result_data:
            pd = self.data_manager.get_planned_data()
            if insert_idx is not None:
                for i, it in enumerate(dlg.result_data):
                    pd["months"][m_idx]["items"].insert(insert_idx + i, it)
            else:
                pd["months"][m_idx]["items"].extend(dlg.result_data)
            self.data_manager.mark_modified()
            self._refresh_tree()
            if insert_idx is not None:
                self._sel_item(m_idx, insert_idx)
            else:
                self._sel_month(m_idx)

    def edit_item(self):
        _, info = self._get_sel()
        if info and info["type"] == "item":
            pd = self.data_manager.get_planned_data()
            it = pd["months"][info["m_index"]]["items"][info["i_index"]]
            dlg = PlannedItemDialog(self,
                                    title=it.get("title", ""),
                                    role=it.get("role", ""))
            if dlg.exec() == QDialog.Accepted and dlg.result_data:
                it.update(dlg.result_data)
                self.data_manager.mark_modified()
                self._refresh_tree()

    def delete_item(self):
        _, info = self._get_sel()
        if info and info["type"] == "item":
            pd = self.data_manager.get_planned_data()
            pd["months"][info["m_index"]]["items"].pop(info["i_index"])
            self.data_manager.mark_modified()
            self._refresh_tree()

    def move_item_to_month(self):
        _, info = self._get_sel()
        if info and info["type"] == "item":
            pd = self.data_manager.get_planned_data()
            months = pd["months"]
            dlg = MoveDialog(self, months, info["m_index"],
                             "月に移動", "移動先の月を選択:")
            if (dlg.exec() == QDialog.Accepted
                    and dlg.result_index is not None
                    and dlg.result_index != info["m_index"]):
                item = months[info["m_index"]]["items"].pop(info["i_index"])
                months[dlg.result_index]["items"].append(item)
                self.data_manager.mark_modified()
                self._refresh_tree()

    def move_to_current(self):
        """選択中のシナリオを通過予定タブの「現行」月に移動する"""
        _, info = self._get_sel()
        if not info or info["type"] != "item":
            _silent_info(self, "情報", "月のシナリオを選択してください。")
            return

        pd = self.data_manager.get_planned_data()
        months = pd["months"]

        current_month_idx = next(
            (i for i, m in enumerate(months) if m.get("label", "") == "現行"), None)

        if current_month_idx is None:
            _silent_warning(
                self, "警告",
                "「現行」という名前の月が見つかりません。\n"
                "通過予定タブに「現行」という月を作成してください。")
            return

        if current_month_idx == info["m_index"]:
            _silent_info(self, "情報", "すでに「現行」にあります。")
            return

        item_data = months[info["m_index"]]["items"].pop(info["i_index"])
        title = item_data.get("title", "")
        months[current_month_idx]["items"].append(item_data)

        self.data_manager.mark_modified()
        self._refresh_tree()
        _silent_info(
            self, "完了", f"「{title}」を「現行」に移動しました。")

    def complete_item(self):
        """完了ボタンの処理"""
        _, info = self._get_sel()
        if not info or info["type"] != "item":
            _silent_info(self, "情報", "月のシナリオを選択してください。")
            return
        
        if self.passed_tab is None:
            _silent_critical(self, "エラー", "通過済みタブへの参照がありません。")
            return

        pd = self.data_manager.get_planned_data()
        item_data = pd["months"][info["m_index"]]["items"][info["i_index"]]
        title = item_data.get("title", "")
        role = item_data.get("role", "")

        # 役割に「KP」が含まれている場合
        if "KP" in role:
            if _silent_question(self, "確認", f"KP予定の「{title}」を予定から削除しますか?") == QMessageBox.Yes:
                pd["months"][info["m_index"]]["items"].pop(info["i_index"])
                self.data_manager.mark_modified()
                self._refresh_tree()
                _silent_info(self, "完了", f"「{title}」を削除しました。")
            return

        # 役割が「PL」のみの場合はHOを空に、それ以外は役割をHOに
        ho_text = "" if role == "PL" else role

        groups = self.passed_tab._get_current_groups()
        if groups is None:
            _silent_critical(self, "エラー", "通過済みタブのグループが取得できません。")
            return

        # 同名シナリオが通過済みタブに存在するかチェック
        exists = any(item.get("title") == title for g in groups for item in g.get("items", []))
        if exists:
            reply = _silent_question(
                self, "警告",
                f"「{title}」はすでに通過済みタブに存在します。\n「追加する」(はい) か「追加しない」(いいえ) か選んでください。",
                QMessageBox.Yes | QMessageBox.No | QMessageBox.Cancel)
            
            if reply == QMessageBox.Cancel:
                return
            elif reply == QMessageBox.No:
                # 追加しない場合は通過予定からの削除のみ
                pd["months"][info["m_index"]]["items"].pop(info["i_index"])
                self.data_manager.mark_modified()
                self._refresh_tree()
                _silent_info(self, "完了", f"「{title}」を予定から削除しました。")
                return
            # Yes の場合はそのまま追加処理に進む

        # 「未分類」カテゴリを探す
        uncategorized_group = next((g for g in groups if g.get("label", "") == "未分類"), None)
        if uncategorized_group is None:
            # 未分類カテゴリがない場合は作成
            uncategorized_group = {"label": "未分類", "items": []}
            groups.append(uncategorized_group)

        # 未分類カテゴリに追加
        uncategorized_group["items"].append({
            "title": title, "ho": ho_text, "favorite": False, "favorite_ho": False
        })
        
        # 通過予定から削除
        pd["months"][info["m_index"]]["items"].pop(info["i_index"])
        
        self.data_manager.mark_modified()
        self._refresh_tree()
        self.passed_tab.refresh()
        
        _silent_info(self, "完了", f"「{title}」を通過済みの「未分類」に追加しました。")

    def move_up(self):
        _, info = self._get_sel()
        if not info:
            return
        pd = self.data_manager.get_planned_data()
        months = pd["months"]
        if info["type"] == "month":
            idx = info["index"]
            if idx > 0:
                months[idx], months[idx-1] = months[idx-1], months[idx]
                self.data_manager.mark_modified()
                self._refresh_tree()
                self._sel_month(idx-1)
        elif info["type"] == "item":
            m, i = info["m_index"], info["i_index"]
            items = months[m]["items"]
            if i > 0:
                items[i], items[i-1] = items[i-1], items[i]
                self.data_manager.mark_modified()
                self._refresh_tree()
                self._sel_item(m, i-1)

    def move_down(self):
        _, info = self._get_sel()
        if not info:
            return
        pd = self.data_manager.get_planned_data()
        months = pd["months"]
        if info["type"] == "month":
            idx = info["index"]
            if idx < len(months) - 1:
                months[idx], months[idx+1] = months[idx+1], months[idx]
                self.data_manager.mark_modified()
                self._refresh_tree()
                self._sel_month(idx+1)
        elif info["type"] == "item":
            m, i = info["m_index"], info["i_index"]
            items = months[m]["items"]
            if i < len(items) - 1:
                items[i], items[i+1] = items[i+1], items[i]
                self.data_manager.mark_modified()
                self._refresh_tree()
                self._sel_item(m, i+1)

    def _move_item_dnd(self, src, tgt):
        si = _idata(src)
        ti = _idata(tgt)
        if not si or not ti:
            return
        pd = self.data_manager.get_planned_data()
        months = pd["months"]

        if si["type"] == "month":
            if ti["type"] == "month":
                a, b = si["index"], ti["index"]
                m = months.pop(a)
                if a < b:
                    b -= 1
                months.insert(b, m)
                self.data_manager.mark_modified()
                self._refresh_tree()
            return

        if si["type"] == "item":
            sm, si_i = si["m_index"], si["i_index"]
            item = months[sm]["items"].pop(si_i)
            if ti["type"] == "month":
                months[ti["index"]]["items"].append(item)
            elif ti["type"] == "item":
                tm, ti_i = ti["m_index"], ti["i_index"]
                if sm == tm and si_i < ti_i:
                    ti_i -= 1
                months[tm]["items"].insert(ti_i, item)
            self.data_manager.mark_modified()
            self._refresh_tree()


# ---------------------------------------------------------------------------
# Main Application
# ---------------------------------------------------------------------------
class ScenarioManagerApp(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("シナリオ・HO管理")
        self.resize(900, 650)

        self.data_manager = DataManager()
        self.data_manager._parent_widget = self

        self._setup_menu()
        self._setup_ui()

        QShortcut(QKeySequence("Ctrl+S"), self, self.save_file)

        default_path = (
            r"C:\Users\raindex963\Documents\GitHub\trpg-profile"
            r"\trpg-profile\data\scenarios.json"
        )
        if os.path.exists(default_path):
            if self.data_manager.load_file(default_path):
                self.refresh_ui()

    def _setup_menu(self):
        mb = self.menuBar()
        fm = mb.addMenu("ファイル")
        for label, slot in [
            ("開く", self.open_file),
            ("保存", self.save_file),
            ("名前を付けて保存", self.save_as_file),
            (None, None),
            ("終了", self.close),
        ]:
            if label is None:
                fm.addSeparator()
            else:
                a = QAction(label, self)
                a.triggered.connect(slot)
                fm.addAction(a)

    def _setup_ui(self):
        self.notebook = QTabWidget()
        self.setCentralWidget(self.notebook)

        self.tab_passed = PassedTab(self, self.data_manager)
        self.tab_watched = WatchedTab(self, self.data_manager)
        self.tab_gm = GMTab(self, self.data_manager)
        self.tab_planned = PlannedTab(
            self, self.data_manager, passed_tab=self.tab_passed)

        self.notebook.addTab(self.tab_passed,  "通過済み")
        self.notebook.addTab(self.tab_watched, "視聴/既読")
        self.notebook.addTab(self.tab_gm,      "GM経験")
        self.notebook.addTab(self.tab_planned, "通過予定")

        self.setStatusBar(QStatusBar())

    def open_file(self):
        path, _ = QFileDialog.getOpenFileName(
            self, "開く", "",
            "JSONファイル (*.json);;すべてのファイル (*.*)")
        if path and self.data_manager.load_file(path):
            self.refresh_ui()

    def save_file(self):
        if self.data_manager.save_file():
            self.statusBar().showMessage("保存しました", 3000)
        elif not self.data_manager.filepath:
            self.save_as_file()

    def save_as_file(self):
        path, _ = QFileDialog.getSaveFileName(
            self, "名前を付けて保存", "",
            "JSONファイル (*.json);;すべてのファイル (*.*)")
        if path and self.data_manager.save_file(path):
            self.statusBar().showMessage(
                f"保存しました: {os.path.basename(path)}", 3000)

    def refresh_ui(self):
        self.tab_passed.refresh_systems()
        self.tab_watched.refresh_systems()
        self.tab_gm.refresh_systems()
        self.tab_planned.refresh()

    def closeEvent(self, event):
        if self.data_manager.is_modified:
            ret = _silent_question(
                self, "未保存の変更",
                "変更が保存されていません。\n保存しますか?",
                QMessageBox.Yes | QMessageBox.No | QMessageBox.Cancel
            )
            if ret == QMessageBox.Cancel:
                event.ignore()
                return
            if ret == QMessageBox.Yes:
                if not self.data_manager.save_file():
                    if not self.data_manager.filepath:
                        self.save_as_file()
                    if self.data_manager.is_modified:
                        event.ignore()
                        return
        event.accept()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def main():
    app = QApplication(sys.argv)
    # 日本語入力のフォントを統一（IMEプリエディット対策）
    font = QFont("Yu Gothic UI", 10)
    app.setFont(font)

    window = ScenarioManagerApp()
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
