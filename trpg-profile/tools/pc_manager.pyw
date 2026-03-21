import sys
import os
import json
import shutil
import datetime
import re
from pathlib import Path
from PySide6.QtWidgets import (QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout, 
                               QListWidget, QListWidgetItem, QPushButton, QLabel, QLineEdit, 
                               QTextEdit, QSplitter, QMessageBox, QFileDialog, QScrollArea,
                               QFormLayout, QGroupBox, QSpinBox, QCheckBox, QFrame, QMenu, QStyle, QComboBox)
from PySide6.QtCore import Qt, QSize, Signal, QMimeData
from PySide6.QtGui import QDragEnterEvent, QDropEvent, QPixmap, QIcon, QAction

# Constants
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_FILE = PROJECT_ROOT / "data/pcs.json"
ASSETS_DIR = PROJECT_ROOT / "data/assets/pcs"
TRASH_DIR = PROJECT_ROOT / "data/.trash"
BACKUP_DIR = PROJECT_ROOT / "data"

class ZeroPaddedSpinBox(QSpinBox):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setRange(1, 999)
        self.setDisplayIntegerBase(10)
        self.setFixedWidth(80) # Adjust width
        # self.valueChanged.connect(self.validate_value) # No internal validation needed, logic handled externally

    def textFromValue(self, value):
        return f"{value:03d}"

    def valueFromText(self, text):
        return int(text) if text.isdigit() else 0
    
    def validate(self, input_text, pos):
        return super().validate(input_text, pos)

class DataManager:
    """Handles JSON data loading, saving, and backups."""
    def __init__(self):
        self.data = []
        self.ensure_directories()

    def ensure_directories(self):
        if not DATA_FILE.parent.exists():
            os.makedirs(DATA_FILE.parent, exist_ok=True)
        if not ASSETS_DIR.exists():
            os.makedirs(ASSETS_DIR, exist_ok=True)
        if not TRASH_DIR.exists():
            os.makedirs(TRASH_DIR, exist_ok=True)

    def load_data(self):
        if not DATA_FILE.exists():
            return []
        try:
            with open(DATA_FILE, 'r', encoding='utf-8') as f:
                self.data = json.load(f)
            return self.data
        except Exception as e:
            print(f"Error loading data: {e}")
            return []

    def save_data(self, data, allow_duplicate_ids=False):
        # ID Duplicate Check
        ids = [pc.get('id', '') for pc in data]
        duplicates = [x for x in set(ids) if ids.count(x) > 1 and x != ""]
        
        if duplicates and not allow_duplicate_ids:
            return False, f"ID重複エラー: {', '.join(duplicates)}\nこれらのIDは重複しています。修正するか、「一時的に重複IDを許可」にチェックを入れてください。"


        try:
            with open(DATA_FILE, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=4, ensure_ascii=False)
            self.data = data
            return True, "Success"
        except Exception as e:
            return False, f"Error saving data: {e}"



    def generate_new_id(self):
        max_num = 0
        for pc in self.data:
            pid = pc.get('id', '')
            match = re.search(r'(\d+)', pid)
            if match:
                num = int(match.group(1))
                if num > max_num:
                    max_num = num
        return f"{max_num + 1:03d}"

class PlaceholderImageGenerator:
    """仮画像生成クラス (Deprecated)"""
    
    @staticmethod
    def generate_icon(text, size=200):
        """(Deprecated) Return transparent/empty or handled elsewhere"""
        return None
    
    @staticmethod
    def generate_standing(text, width=400, height=800):
        """(Deprecated)"""
        return None

class ImageManager:
    """Handles image file operations (copy, trash)."""
    
    @staticmethod
    def get_asset_path(pc_id, category):
        """Returns the absolute path to the asset category directory."""
        return ASSETS_DIR / pc_id / category

    @staticmethod
    def import_image(file_path, pc_id, category):
        """Copies image to assets folder and returns project-relative path."""
        src_path = Path(file_path)
        if not src_path.exists():
            return None
            
        dest_dir = ImageManager.get_asset_path(pc_id, category)
        os.makedirs(dest_dir, exist_ok=True)
        
        filename = src_path.name
        # Sanitize filename: remove special characters that break URLs
        filename = re.sub(r'[#\?\@\%\+\s]', '', filename)
        
        dest_path = dest_dir / filename
        
        # Handle duplicates
        if dest_path.exists():
            sanitized_path = Path(filename)
            stem = sanitized_path.stem
            suffix = sanitized_path.suffix
            timestamp = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
            filename = f"{stem}_{timestamp}{suffix}"
            dest_path = dest_dir / filename
            
        try:
            shutil.copy2(src_path, dest_path)
            # Return relative path for JSON (Unix style separators)
            rel_path = str(dest_path.relative_to(PROJECT_ROOT)).replace('\\', '/')
            return rel_path
        except Exception as e:
            print(f"Error importing image: {e}")
            return None

    @staticmethod
    def move_to_trash(relative_path):
        """Moves file to trash directory."""
        if not relative_path:
            return
            
        full_path = PROJECT_ROOT / relative_path
        if not full_path.exists():
            return

        timestamp = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
        trash_name = f"{timestamp}__{full_path.name}"
        trash_path = TRASH_DIR / trash_name
        
        try:
            if not trash_path.parent.exists():
                os.makedirs(trash_path.parent, exist_ok=True)
            shutil.move(full_path, trash_path)
            print(f"Moved to trash: {trash_path}")
        except Exception as e:
            print(f"Error moving to trash: {e}")

    @staticmethod
    def rename_assets(old_id, new_id):
        """Renames the asset directory for a PC."""
        if not old_id or not new_id or old_id == new_id:
            return True
        
        old_dir = ASSETS_DIR / old_id
        new_dir = ASSETS_DIR / new_id
        
        if old_dir.exists():
            if new_dir.exists():
                print(f"Target directory {new_dir} already exists. Cannot rename {old_dir}.")
                return False
            else:
                try:
                    old_dir.rename(new_dir)
                    print(f"Renamed {old_dir} to {new_dir}")
                    return True
                except Exception as e:
                    print(f"Error renaming directory: {e}")
                    return False
        return True

    @staticmethod
    def swap_assets(id1, id2):
        """Swaps asset directories between two PCs."""
        dir1 = ASSETS_DIR / id1
        dir2 = ASSETS_DIR / id2
        
        # Scenario: Both exist
        if dir1.exists() and dir2.exists():
            temp_dir = ASSETS_DIR / f"temp_swap_{datetime.datetime.now().strftime('%f')}"
            try:
                dir1.rename(temp_dir)
                dir2.rename(dir1)
                temp_dir.rename(dir2)
                return True
            except Exception as e:
                print(f"Error swapping directories: {e}")
                return False
        
        # Scenario: Only dir1 exists (Rename 1->2)
        elif dir1.exists():
            return ImageManager.rename_assets(id1, id2)
            
        # Scenario: Only dir2 exists (Rename 2->1)
        elif dir2.exists():
            return ImageManager.rename_assets(id2, id1)
            
        # Neither exists
        return True

class ImageDropWidget(QFrame):
    imageChanged = Signal(str) # Emits new relative path or empty string
    
    def __init__(self, category, label_text, parent=None):
        super().__init__(parent)
        self.category = category
        self.label_text = label_text
        self.current_rel_path = ""
        self.pc_id = ""
        
        self.setAcceptDrops(True)
        self.setFrameStyle(QFrame.StyledPanel | QFrame.Sunken)
        self.setFixedHeight(150)
        
        self.layout = QVBoxLayout(self)
        self.layout.setContentsMargins(0, 0, 0, 0)
        
        self.img_label = QLabel(self.label_text)
        self.img_label.setAlignment(Qt.AlignCenter)
        self.img_label.setWordWrap(True)
        # self.img_label.setScaledContents(False) # We handle scaling
        self.layout.addWidget(self.img_label)
        
        self.original_pixmap = None
        
        # Trash Button (Overlay or Context Menu - sticking to Context Menu + a small button)
        # To keep it simple, right click menu

    def set_data(self, pc_id, rel_path):
        self.pc_id = pc_id
        if self.current_rel_path != rel_path:
             self.current_rel_path = rel_path
             self.update_display()
        
    def update_display(self):
        self.original_pixmap = None
        if self.current_rel_path:
            full_path = PROJECT_ROOT / self.current_rel_path
            if full_path.exists():
                pixmap = QPixmap(str(full_path))
                if not pixmap.isNull():
                    self.original_pixmap = pixmap
                    self.update_pixmap_display()
                    self.img_label.setText("")
                else:
                    self.img_label.setText(f"{self.label_text}\n(無効な画像)")
            else:
                self.img_label.setText(f"{self.label_text}\n(リンク切れ: {self.current_rel_path})")
        else:
            # 仮画像を生成せず、テキストのみ表示
            self.img_label.setText(f"{self.label_text}\n(Drag & Drop)")

    def update_pixmap_display(self):
        if self.original_pixmap and not self.original_pixmap.isNull():
             # Scale to current size
             size = self.size()
             if size.width() > 0 and size.height() > 0:
                 scaled = self.original_pixmap.scaled(size, Qt.KeepAspectRatio, Qt.SmoothTransformation)
                 self.img_label.setPixmap(scaled)

    def resizeEvent(self, event):
        self.update_pixmap_display()
        super().resizeEvent(event)

    def dragEnterEvent(self, event: QDragEnterEvent):
        if event.mimeData().hasUrls():
            event.acceptProposedAction()

    def dropEvent(self, event: QDropEvent):
        if not self.pc_id:
            QMessageBox.warning(self, "Error", "IDが設定されていません。先にIDを入力してください。")
            return

        urls = event.mimeData().urls()
        if urls:
            file_path = urls[0].toLocalFile()
            if os.path.isfile(file_path):
                 # Import Image
                rel_path = ImageManager.import_image(file_path, self.pc_id, self.category)
                if rel_path:
                    self.current_rel_path = rel_path
                    self.update_display()
                    self.imageChanged.emit(rel_path)

    def contextMenuEvent(self, event):
        menu = QMenu(self)
        if self.current_rel_path:
            remove_action = QAction("画像を解除 (ゴミ箱へ移動)", self)
            remove_action.triggered.connect(self.remove_image)
            menu.addAction(remove_action)
        menu.exec(event.globalPos())

    def remove_image(self):
        if not self.current_rel_path:
            return
            
        ret = QMessageBox.question(self, "確認", 
                                   f"以下の画像をゴミ箱へ移動して解除しますか？\n\nPC: {self.pc_id}\nCategory: {self.category}\nPath: {self.current_rel_path}",
                                   QMessageBox.Yes | QMessageBox.No)
        if ret == QMessageBox.Yes:
            ImageManager.move_to_trash(self.current_rel_path)
            self.current_rel_path = ""
            self.update_display()
            self.imageChanged.emit("")
    
    def get_pc_name(self):
        """現在のPCの名前を取得"""
        # 親ウィジェットを辿ってEditorWidgetを見つける
        parent = self.parent()
        while parent:
            if isinstance(parent, EditorWidget):
                if parent.current_pc:
                    return parent.current_pc.get('name', '')
                break
            parent = parent.parent()
        return ""


class EditorWidget(QWidget):
    dataChanged = Signal()
    idChangeRequested = Signal(str, str) # old_id, new_id

    def __init__(self):
        super().__init__()
        self.current_pc = None
        self.updating_ui = False
        self.init_ui()

    def init_ui(self):
        layout = QVBoxLayout(self)

        # ID & Basic Info
        gb_basic = QGroupBox("基本情報")
        form_layout = QFormLayout(gb_basic)
        
        self.inp_id = ZeroPaddedSpinBox() # Changed to SpinBox
        self.inp_name = QLineEdit()
        self.inp_ruby = QLineEdit()
        
        # Gender Input: Combo + Free Text
        self.layout_gender = QHBoxLayout()
        self.combo_gender = QComboBox()
        self.combo_gender.addItems(["男性", "女性", "その他"])
        self.inp_gender_free = QLineEdit()
        self.inp_gender_free.setPlaceholderText("自由記述")
        self.inp_gender_free.setVisible(False) # Initial state
        
        self.layout_gender.addWidget(self.combo_gender)
        self.layout_gender.addWidget(self.inp_gender_free)
        
        self.layout_age = QHBoxLayout()
        self.inp_age = QLineEdit()
        self.chk_age_no_unit = QCheckBox("歳なし")
        self.layout_age.addWidget(self.inp_age)
        self.layout_age.addWidget(self.chk_age_no_unit)
        
        self.layout_height = QHBoxLayout()
        self.inp_height = QLineEdit()
        self.chk_height_no_unit = QCheckBox("cmなし")
        self.layout_height.addWidget(self.inp_height)
        self.layout_height.addWidget(self.chk_height_no_unit)
        
        self.inp_job = QLineEdit()
        
        # ロストフラグのチェックボックスを追加
        self.chk_is_lost = QCheckBox("ロストフラグ")

        form_layout.addRow("ID:", self.inp_id)
        form_layout.addRow("名前:", self.inp_name)
        form_layout.addRow("よみ:", self.inp_ruby)
        form_layout.addRow("性別:", self.layout_gender)
        form_layout.addRow("年齢:", self.layout_age)
        form_layout.addRow("身長:", self.layout_height)
        form_layout.addRow("職業:", self.inp_job)
        form_layout.addRow("", self.chk_is_lost)
        
        layout.addWidget(gb_basic)

        # Initialize editing state
        self.editing_scenario_index = None

        # Connect basic inputs
        self.inp_id.valueChanged.connect(self.check_id_change) # Modified Connection
        self.inp_name.textChanged.connect(self.update_data)
        self.inp_ruby.textChanged.connect(self.update_data)
        
        self.combo_gender.currentTextChanged.connect(self.on_gender_combo_changed)
        self.combo_gender.currentTextChanged.connect(self.update_profile_data)
        self.inp_gender_free.textChanged.connect(self.update_profile_data)
        
        self.inp_gender_free.textChanged.connect(self.update_profile_data)
        
        self.inp_age.textChanged.connect(self.update_profile_data)
        self.chk_age_no_unit.toggled.connect(self.update_profile_data)
        self.inp_height.textChanged.connect(self.update_profile_data)
        self.chk_height_no_unit.toggled.connect(self.update_profile_data)
        self.inp_job.textChanged.connect(self.update_profile_data)
        self.chk_is_lost.toggled.connect(self.update_data)

        # Images - Separated
        # Icon
        gb_icon = QGroupBox("アイコン")
        layout_icon = QVBoxLayout(gb_icon)
        self.drop_icon = ImageDropWidget("icon", "ICON")
        layout_icon.addWidget(self.drop_icon)
        layout.addWidget(gb_icon)

        # Main (Standing Picture)
        gb_main = QGroupBox("立ち絵 (Main)")
        layout_main = QVBoxLayout(gb_main)
        self.drop_main = ImageDropWidget("main", "立ち絵")
        layout_main.addWidget(self.drop_main)
        layout.addWidget(gb_main)
        
        self.drop_icon.imageChanged.connect(lambda p: self.update_image_field("image_icon", p))
        self.drop_main.imageChanged.connect(lambda p: self.update_image_field("image_main", p))

        # Diff Images
        gb_diff = QGroupBox("差分画像 (Diff)")
        self.layout_diff = QVBoxLayout(gb_diff)
        self.diff_list_layout = QHBoxLayout() # Container for widgets
        self.layout_diff.addLayout(self.diff_list_layout)
        
        self.drop_diff_adder = ImageDropWidget("diff", "＋差分追加\n(Drop Here)")
        self.layout_diff.addWidget(self.drop_diff_adder)
        self.drop_diff_adder.imageChanged.connect(self.add_diff_image)
        layout.addWidget(gb_diff)

        # Passed Scenarios
        gb_scenarios = QGroupBox("通過済みシナリオ")
        v_layout_sc = QVBoxLayout(gb_scenarios)
        self.list_scenarios = QListWidget()
        v_layout_sc.addWidget(self.list_scenarios)
        
        # Input fields
        input_layout = QVBoxLayout()
        
        self.inp_scenario_title = QLineEdit()
        self.inp_scenario_title.setPlaceholderText("シナリオ名")
        input_layout.addWidget(QLabel("シナリオ名:"))
        input_layout.addWidget(self.inp_scenario_title)
        
        self.inp_scenario_ho = QLineEdit()
        self.inp_scenario_ho.setPlaceholderText("HO名 (例: KPC)")
        input_layout.addWidget(QLabel("HO名:"))
        input_layout.addWidget(self.inp_scenario_ho)
        
        self.inp_scenario_end = QLineEdit()
        self.inp_scenario_end.setPlaceholderText("END番号 (例: END1, 予定)")
        input_layout.addWidget(QLabel("END番号:"))
        input_layout.addWidget(self.inp_scenario_end)
        
        self.chk_scenario_if = QCheckBox("IFシナリオ")
        input_layout.addWidget(self.chk_scenario_if)
        
        # Buttons
        h_layout_sc_btns = QHBoxLayout()
        self.btn_add_sc = QPushButton("追加")
        self.btn_edit_sc = QPushButton("編集")
        self.btn_save_sc = QPushButton("保存")
        self.btn_save_sc.setVisible(False)  # 初期状態では非表示
        self.btn_del_sc = QPushButton("削除")
        h_layout_sc_btns.addWidget(self.btn_add_sc)
        h_layout_sc_btns.addWidget(self.btn_edit_sc)
        h_layout_sc_btns.addWidget(self.btn_save_sc)
        h_layout_sc_btns.addWidget(self.btn_del_sc)
        
        input_layout.addLayout(h_layout_sc_btns)
        v_layout_sc.addLayout(input_layout)
        
        self.btn_add_sc.clicked.connect(self.add_scenario)
        self.btn_edit_sc.clicked.connect(self.edit_scenario)
        self.btn_save_sc.clicked.connect(self.save_scenario)
        self.btn_del_sc.clicked.connect(self.delete_scenario)
        self.list_scenarios.currentRowChanged.connect(self.on_scenario_row_changed)
        layout.addWidget(gb_scenarios)

        # Arts
        gb_arts = QGroupBox("Arts (Fan Art / Skeb)")
        self.layout_arts = QVBoxLayout(gb_arts)
        
        self.btn_add_art_zone = QPushButton("＋ Art追加エリアを表示")
        self.btn_add_art_zone.clicked.connect(self.add_art_widget)
        self.layout_arts.addWidget(self.btn_add_art_zone)
        
        layout.addWidget(gb_arts)
        
        layout.addStretch()

    def set_pc(self, pc_data):
        self.current_pc = pc_data
        self.updating_ui = True # Start blocking updates
        
        pid_str = pc_data.get('id', '')
        match = re.search(r'(\d+)', pid_str)
        if match:
            self.inp_id.setValue(int(match.group(1)))
        else:
            self.inp_id.setValue(0)

        self.inp_name.setText(pc_data.get('name', ''))
        self.inp_ruby.setText(pc_data.get('ruby', ''))
        
        profile = pc_data.get('profile', {})
        
        # Gender Logic
        gender = profile.get('gender', '')
        if not gender:
            gender = "男性" # Default
            # Force update data so it saves even if user doesn't change it
            self.current_pc['profile']['gender'] = gender
            
        if gender in ["男性", "女性"]:
            self.combo_gender.setCurrentText(gender)
            self.inp_gender_free.clear()
        else:
            self.combo_gender.setCurrentText("その他")
            # If "その他", set text to "その他" or empty? 
            # If data is "その他", free text should be empty or "その他"?
            # User requirement: "If empty, display 'その他'". So if data is "その他", free input should be empty.
            if gender == "その他":
                 self.inp_gender_free.clear()
            else:
                 self.inp_gender_free.setText(gender)
        
        self.on_gender_combo_changed(self.combo_gender.currentText())

        age = profile.get('age', '')
        if not age:
             # Empty -> Default to "歳" enabled (Checkbox OFF)
             self.inp_age.setText("")
             self.chk_age_no_unit.setChecked(False)
        elif age.endswith("歳"):
             self.inp_age.setText(age[:-1])
             self.chk_age_no_unit.setChecked(False)
        elif age.isdigit():
             # Numeric string without units -> Treat as "歳" (Checkbox OFF)
             self.inp_age.setText(age)
             self.chk_age_no_unit.setChecked(False)
        else:
             # Non-empty, non-numeric, no "歳" (e.g. "不明", "？")
             # In this case, "No Unit" is TRUE.
             self.inp_age.setText(age)
             self.chk_age_no_unit.setChecked(True)
        
        height = profile.get('height', '')
        if not height:
             # Empty -> Default to cm enabled (Checkbox OFF)
             self.inp_height.setText("")
             self.chk_height_no_unit.setChecked(False)
        elif height.endswith("cm"):
             self.inp_height.setText(height[:-2])
             self.chk_height_no_unit.setChecked(False)
        elif height.isdigit():
             # Numeric string without units -> Treat as cm (Checkbox OFF)
             self.inp_height.setText(height)
             self.chk_height_no_unit.setChecked(False)
        else:
             # Non-empty, non-numeric, no cm (e.g. "不明", "1m70", "170?")
             # In this case, "No Unit" is TRUE.
             self.inp_height.setText(height)
             self.chk_height_no_unit.setChecked(True)
             
        self.inp_job.setText(profile.get('job', ''))
        
        # ロストフラグの読み込み
        self.chk_is_lost.setChecked(pc_data.get('is_lost', False))
        
        # Images
        self.drop_icon.set_data(pc_data.get('id', ''), pc_data.get('image_icon', ''))
        self.drop_main.set_data(pc_data.get('id', ''), pc_data.get('image_main', ''))
        self.drop_diff_adder.set_data(pc_data.get('id', ''), "")
        
        self.refresh_diff_list()
        
        # Scenarios
        self.cancel_scenario_edit()  # 編集状態を破棄してからリセット
        self.list_scenarios.clear()
        for sc in pc_data.get('passed_scenarios', []):
            if isinstance(sc, dict):
                display_text = sc.get('title', '')
                if sc.get('is_if'):
                     display_text = f"[IF] {display_text}"
                if sc.get('ho'):
                    display_text += f" [HO: {sc['ho']}]"
                if sc.get('end'):
                    display_text += f" [END: {sc['end']}]"
                self.list_scenarios.addItem(display_text)
            else:
                # 旧形式(文字列)の互換性
                self.list_scenarios.addItem(sc)
            
        # Arts: Clear and Rebuild
        self.refresh_arts_list()
        
        self.updating_ui = False # Stop blocking updates

    def check_id_change(self):
        if self.updating_ui or not self.current_pc: return
        
        new_id_val = self.inp_id.value()
        new_id_str = f"{new_id_val:03d}"
        old_id_str = self.current_pc.get('id', '')
        
        if new_id_str != old_id_str:
            self.idChangeRequested.emit(old_id_str, new_id_str)

    def update_data(self):
        if self.updating_ui or not self.current_pc: return
        
        # ID is handled separately now via check_id_change -> MainWindow -> set_pc
        
        self.current_pc['name'] = self.inp_name.text()
        self.current_pc['ruby'] = self.inp_ruby.text()
        
        # ロストフラグの保存
        self.current_pc['is_lost'] = self.chk_is_lost.isChecked()
        
        # Propagate ID to image widgets (using current ID)
        current_id = self.current_pc.get('id', '')
        
        self.drop_icon.set_data(current_id, self.current_pc.get('image_icon', ''))
        self.drop_main.set_data(current_id, self.current_pc.get('image_main', ''))
        self.drop_diff_adder.set_data(current_id, "")
        
        # Update placeholder images if name changed
        self.drop_icon.update_display()
        self.drop_main.update_display()
        
        # We also need to update ID for diff items and art items, 
        # but since set_data resets the path, we must be careful not to lost paths if we just want to update ID.
        # ImageDropWidget.set_data(pc_id, existing_path) is consistent.
        
        # Update Diff Widgets
        # Iterate over layout? Or just rebuild? Rebuild is safer but might lag if many items.
        # But here we just want to update the internal pc_id of the widget.
        # Let's iterate layout.
        for i in range(self.diff_list_layout.count()):
            item = self.diff_list_layout.itemAt(i)
            widget = item.widget()
            if widget:
                # The widget is a container QWidget with VBox
                # The DropWidget is the first item in that VBox
                layout = widget.layout()
                if layout and layout.count() > 0:
                    dw = layout.itemAt(0).widget()
                    if isinstance(dw, ImageDropWidget):
                        # Get current path from current_pc to be safe
                        current_path = self.current_pc['images_diff'][i] if i < len(self.current_pc['images_diff']) else ""
                        dw.set_data(current_id, current_path)

        # Update Art Widgets
        # Arts are in self.layout_arts. Items are containers.
        for i in range(self.layout_arts.count()):
            item = self.layout_arts.itemAt(i)
            widget = item.widget()
            if widget and widget != self.btn_add_art_zone:
                # Container -> HBox -> DropWidget is at index 0
                layout = widget.layout()
                if layout and layout.count() > 0:
                    dw = layout.itemAt(0).widget()
                    if isinstance(dw, ImageDropWidget):
                        current_path = self.current_pc['arts'][i]['url'] if i < len(self.current_pc['arts']) else ""
                        dw.set_data(current_id, current_path)

        self.dataChanged.emit()

    def on_gender_combo_changed(self, text):
        if text == "その他":
            self.inp_gender_free.setVisible(True)
        else:
            self.inp_gender_free.setVisible(False)

    def update_profile_data(self):
        if self.updating_ui or not self.current_pc: return
        if 'profile' not in self.current_pc: self.current_pc['profile'] = {}
        
        # Gender Logic
        gender_selection = self.combo_gender.currentText()
        if gender_selection == "その他":
            free_text = self.inp_gender_free.text().strip()
            if free_text:
                self.current_pc['profile']['gender'] = free_text
            else:
                self.current_pc['profile']['gender'] = "その他"
        else:
            self.current_pc['profile']['gender'] = gender_selection
            
        age_val = self.inp_age.text()
        if not self.chk_age_no_unit.isChecked() and age_val and not age_val.endswith("歳"):
             age_val += "歳"
             
        self.current_pc['profile']['age'] = age_val
        height_val = self.inp_height.text()
        if not self.chk_height_no_unit.isChecked() and height_val and not height_val.endswith("cm"):
             height_val += "cm"
             
        self.current_pc['profile']['height'] = height_val
        self.current_pc['profile']['job'] = self.inp_job.text()
        self.dataChanged.emit()

    def update_image_field(self, field, rel_path):
        if not self.current_pc: return
        self.current_pc[field] = rel_path
        self.dataChanged.emit()

    # --- Diff Handling ---
    def add_diff_image(self, rel_path):
        if not self.current_pc: return
        if 'images_diff' not in self.current_pc:
            self.current_pc['images_diff'] = []
        
        if rel_path:
            self.current_pc['images_diff'].append(rel_path)
            self.refresh_diff_list()
            self.dataChanged.emit()
            self.drop_diff_adder.set_data(self.current_pc.get('id', ''), "") 
    
    def refresh_diff_list(self):
        while self.diff_list_layout.count():
            item = self.diff_list_layout.takeAt(0)
            widget = item.widget()
            if widget:
                widget.deleteLater()
        
        diffs = self.current_pc.get('images_diff', [])
        for i, path in enumerate(diffs):
            # Container for Diff Item (Image + Delete Button)
            container = QWidget()
            v_layout = QVBoxLayout(container)
            v_layout.setContentsMargins(0, 0, 0, 0)
            
            dw = ImageDropWidget("diff", f"Diff {i+1}")
            dw.set_data(self.current_pc.get('id', ''), path)
            dw.setFixedSize(100, 100)
            dw.imageChanged.connect(lambda p, idx=i: self.update_diff_at(idx, p))
            
            btn_del = QPushButton("削除")
            btn_del.clicked.connect(lambda _, idx=i: self.delete_diff(idx))
            
            v_layout.addWidget(dw)
            v_layout.addWidget(btn_del)
            
            self.diff_list_layout.addWidget(container)

    def update_diff_at(self, idx, new_path):
        if not self.current_pc: return
        if not new_path:
            # Triggered by context menu clean or similar?
            # If so, treating it like delete
             del self.current_pc['images_diff'][idx]
        else:
            self.current_pc['images_diff'][idx] = new_path
        self.refresh_diff_list()
        self.dataChanged.emit()

    def delete_diff(self, idx):
        if not self.current_pc: return
        # Ask to trash?
        path = self.current_pc['images_diff'][idx]
        if path:
             ret = QMessageBox.question(self, "確認", "画像をゴミ箱に移動しますか？", QMessageBox.Yes | QMessageBox.No)
             if ret == QMessageBox.Yes:
                 ImageManager.move_to_trash(path)
        
        del self.current_pc['images_diff'][idx]
        self.refresh_diff_list()
        self.dataChanged.emit()

    # --- Scenario Handling ---
    def add_scenario(self):
        title = self.inp_scenario_title.text().strip()
        if title and self.current_pc:
            if 'passed_scenarios' not in self.current_pc:
                self.current_pc['passed_scenarios'] = []
            
            scenario = {
                "title": title,
                "ho": self.inp_scenario_ho.text().strip(),
                "end": self.inp_scenario_end.text().strip(),
                "is_if": self.chk_scenario_if.isChecked()
            }
            
            self.current_pc['passed_scenarios'].append(scenario)
            
            display_text = title
            if scenario['is_if']:
                display_text = f"[IF] {display_text}"
            if scenario['ho']:
                display_text += f" [HO: {scenario['ho']}]"
            if scenario['end']:
                display_text += f" [END: {scenario['end']}]"
            
            self.list_scenarios.addItem(display_text)
            self.inp_scenario_title.clear()
            self.inp_scenario_ho.clear()
            self.inp_scenario_end.clear()
            self.chk_scenario_if.setChecked(False)
            self.dataChanged.emit()

    def edit_scenario(self):
        row = self.list_scenarios.currentRow()
        if row >= 0 and self.current_pc:
            sc = self.current_pc['passed_scenarios'][row]
            
            if isinstance(sc, dict):
                self.inp_scenario_title.setText(sc.get('title', ''))
                self.inp_scenario_ho.setText(sc.get('ho', ''))
                self.inp_scenario_end.setText(sc.get('end', ''))
                self.chk_scenario_if.setChecked(sc.get('is_if', False))
            else:
                # 旧形式(文字列)の場合
                self.inp_scenario_title.setText(sc)
                self.inp_scenario_ho.clear()
                self.inp_scenario_end.clear()
                self.chk_scenario_if.setChecked(False)
            
            # 編集モードに入る: 追加・編集・削除を隠して保存のみ表示
            self.editing_scenario_index = row
            self.btn_add_sc.setVisible(False)
            self.btn_edit_sc.setVisible(False)
            self.btn_del_sc.setVisible(False)
            self.btn_save_sc.setVisible(True)

    def save_scenario(self):
        """編集中のシナリオを保存"""
        if self.editing_scenario_index is not None and self.current_pc:
            title = self.inp_scenario_title.text().strip()
            if not title:
                QMessageBox.warning(self, "入力エラー", "シナリオ名は必須です。")
                return
            
            scenario = {
                "title": title,
                "ho": self.inp_scenario_ho.text().strip(),
                "end": self.inp_scenario_end.text().strip(),
                "is_if": self.chk_scenario_if.isChecked()
            }
            
            # 既存のシナリオを更新
            self.current_pc['passed_scenarios'][self.editing_scenario_index] = scenario
            
            # リスト表示を更新
            display_text = title
            if scenario['is_if']:
                 display_text = f"[IF] {display_text}"
            if scenario['ho']:
                display_text += f" [HO: {scenario['ho']}]"
            if scenario['end']:
                display_text += f" [END: {scenario['end']}]"
            
            self.list_scenarios.item(self.editing_scenario_index).setText(display_text)
            
            # 編集モードを終了して入力欄をクリア
            self.cancel_scenario_edit()
            
            self.dataChanged.emit()

    def cancel_scenario_edit(self):
        """編集状態を确認なしで破棄して通常モードに戻る"""
        self.editing_scenario_index = None
        self.inp_scenario_title.clear()
        self.inp_scenario_ho.clear()
        self.inp_scenario_end.clear()
        self.chk_scenario_if.setChecked(False)
        self.btn_save_sc.setVisible(False)
        self.btn_add_sc.setVisible(True)
        self.btn_edit_sc.setVisible(True)
        self.btn_del_sc.setVisible(True)

    def on_scenario_row_changed(self, row):
        """変更時に編集中なら破棄する"""
        if self.editing_scenario_index is not None:
            self.cancel_scenario_edit()

    def delete_scenario(self):
        row = self.list_scenarios.currentRow()
        if row >= 0 and self.current_pc:
            del self.current_pc['passed_scenarios'][row]
            self.list_scenarios.takeItem(row)
            self.dataChanged.emit()

    # --- Arts Handling ---
    def add_art_widget(self):
        if not self.current_pc: return
        if 'arts' not in self.current_pc:
            self.current_pc['arts'] = []
        
        self.current_pc['arts'].insert(0, {"url": "", "artist": "", "spoiler": False})
        self.refresh_arts_list()
        self.dataChanged.emit()

    def refresh_arts_list(self):
        while self.layout_arts.count():
            item = self.layout_arts.takeAt(0)
            widget = item.widget()
            if widget and widget != self.btn_add_art_zone:
                widget.deleteLater()
        
        arts = self.current_pc.get('arts', [])
        total_arts = len(arts)
        for i, art in enumerate(arts):
            container = QFrame()
            container.setFrameStyle(QFrame.StyledPanel)
            h_layout = QHBoxLayout(container)

            # ▲▼ 並び替えボタン
            v_order_btns = QVBoxLayout()
            btn_up = QPushButton("▲")
            btn_up.setFixedSize(30, 30)
            btn_up.setToolTip("上へ移動")
            btn_up.setEnabled(i > 0)
            btn_down = QPushButton("▼")
            btn_down.setFixedSize(30, 30)
            btn_down.setToolTip("下へ移動")
            btn_down.setEnabled(i < total_arts - 1)
            v_order_btns.addWidget(btn_up)
            v_order_btns.addWidget(btn_down)
            v_order_btns.addStretch()
            
            drop = ImageDropWidget("arts", "Art Image")
            drop.set_data(self.current_pc.get('id', ''), art.get('url', ''))
            drop.setFixedWidth(120)
            
            # 右側入力エリア
            v_inputs = QVBoxLayout()
            inp_artist = QLineEdit(art.get('artist', ''))
            inp_artist.setPlaceholderText("Artist Name")
            chk_spoiler = QCheckBox("ネタバレ")
            chk_spoiler.setChecked(art.get('spoiler', False))
            inp_scenario = QLineEdit(art.get('spoiler_scenario', ''))
            inp_scenario.setPlaceholderText("ネタバレシナリオ名")
            inp_scenario.setVisible(art.get('spoiler', False))
            btn_del = QPushButton("削除")
            
            v_inputs.addWidget(QLabel("Artist:"))
            v_inputs.addWidget(inp_artist)
            v_inputs.addWidget(chk_spoiler)
            v_inputs.addWidget(inp_scenario)
            v_inputs.addWidget(btn_del)

            # 追加ページエリア
            pages_area = QVBoxLayout()
            pages_area.addWidget(QLabel("追加ページ:"))
            pages = art.get('pages', [])
            for pi, page_url in enumerate(pages):
                pdrop = ImageDropWidget("arts", f"Page {pi+2}")
                pdrop.set_data(self.current_pc.get('id', ''), page_url)
                pdrop.setFixedWidth(100)
                pdel = QPushButton("ページ削除")
                ph = QHBoxLayout()
                ph.addWidget(pdrop)
                ph.addWidget(pdel)
                pages_area.addLayout(ph)
                pdrop.imageChanged.connect(lambda p, idx=i, pidx=pi: self.update_art_page(idx, pidx, p))
                pdel.clicked.connect(lambda _, idx=i, pidx=pi: self.delete_art_page(idx, pidx))
            btn_add_page = QPushButton("+ ページを追加")
            btn_add_page.clicked.connect(lambda _, idx=i: self.add_art_page(idx))
            pages_area.addWidget(btn_add_page)

            v_inputs.addStretch()
            
            h_layout.addLayout(v_order_btns)
            h_layout.addWidget(drop)
            h_layout.addLayout(v_inputs)
            h_layout.addLayout(pages_area)
            
            self.layout_arts.addWidget(container)
            
            btn_up.clicked.connect(lambda _, idx=i: self.move_art_up(idx))
            btn_down.clicked.connect(lambda _, idx=i: self.move_art_down(idx))
            drop.imageChanged.connect(lambda p, idx=i: self.update_art_image(idx, p))
            inp_artist.textChanged.connect(lambda t, idx=i: self.update_art_artist(idx, t))
            chk_spoiler.stateChanged.connect(lambda state, idx=i, inp=inp_scenario: (
                self.update_art_spoiler(idx, bool(state)),
                inp.setVisible(bool(state))
            ))
            inp_scenario.textChanged.connect(lambda t, idx=i: self.update_art_spoiler_scenario(idx, t))
            btn_del.clicked.connect(lambda _, idx=i: self.delete_art(idx))
            
        self.layout_arts.addWidget(self.btn_add_art_zone)

    def update_art_image(self, idx, rel_path):
        if not self.current_pc: return
        if not rel_path: 
             self.current_pc['arts'][idx]['url'] = ""
        else:
            self.current_pc['arts'][idx]['url'] = rel_path
        self.dataChanged.emit()

    def update_art_artist(self, idx, text):
        if not self.current_pc: return
        self.current_pc['arts'][idx]['artist'] = text
        self.dataChanged.emit()

    def update_art_spoiler(self, idx, value):
        if not self.current_pc: return
        self.current_pc['arts'][idx]['spoiler'] = value
        self.dataChanged.emit()

    def update_art_spoiler_scenario(self, idx, text):
        if not self.current_pc: return
        self.current_pc['arts'][idx]['spoiler_scenario'] = text
        self.dataChanged.emit()

    def add_art_page(self, idx):
        """idx番イラストに追加ページを追加"""
        if not self.current_pc: return
        art = self.current_pc['arts'][idx]
        if 'pages' not in art:
            art['pages'] = []
        art['pages'].append("")
        self.refresh_arts_list()
        self.dataChanged.emit()

    def update_art_page(self, idx, page_idx, rel_path):
        if not self.current_pc: return
        pages = self.current_pc['arts'][idx].get('pages', [])
        if page_idx < len(pages):
            pages[page_idx] = rel_path
            self.current_pc['arts'][idx]['pages'] = pages
            self.dataChanged.emit()

    def delete_art_page(self, idx, page_idx):
        if not self.current_pc: return
        art = self.current_pc['arts'][idx]
        pages = art.get('pages', [])
        if page_idx < len(pages):
            rel_path = pages[page_idx]
            if rel_path:
                ret = QMessageBox.question(self, "確認", "画像をゴミ箋に移動しますか？", QMessageBox.Yes | QMessageBox.No)
                if ret == QMessageBox.Yes:
                    ImageManager.move_to_trash(rel_path)
            del pages[page_idx]
            art['pages'] = pages
            self.refresh_arts_list()
            self.dataChanged.emit()

    def move_art_up(self, idx):
        """artsリストのidx番目を1つ上に移動"""
        if not self.current_pc: return
        arts = self.current_pc.get('arts', [])
        if idx <= 0 or idx >= len(arts): return
        arts[idx - 1], arts[idx] = arts[idx], arts[idx - 1]
        self.current_pc['arts'] = arts
        self.refresh_arts_list()
        self.dataChanged.emit()

    def move_art_down(self, idx):
        """artsリストのidx番目を1つ下に移動"""
        if not self.current_pc: return
        arts = self.current_pc.get('arts', [])
        if idx < 0 or idx >= len(arts) - 1: return
        arts[idx], arts[idx + 1] = arts[idx + 1], arts[idx]
        self.current_pc['arts'] = arts
        self.refresh_arts_list()
        self.dataChanged.emit()

    def delete_art(self, idx):
        if not self.current_pc: return
        
        rel_path = self.current_pc['arts'][idx].get('url', '')
        if rel_path:
             ret = QMessageBox.question(self, "確認", "画像をゴミ箱に移動しますか？", QMessageBox.Yes | QMessageBox.No)
             if ret == QMessageBox.Yes:
                 ImageManager.move_to_trash(rel_path)

        del self.current_pc['arts'][idx]
        self.refresh_arts_list()
        self.dataChanged.emit()


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("TRPG Profile - PC Manager")
        self.resize(1200, 800)
        
        self.data_manager = DataManager()
        self.pcs = self.data_manager.load_data()
        self.filtered_pcs = []
        
        self.is_dirty = False
        self.current_pc_id = None
        self.ignore_selection_change = False
        
        self.init_ui()

    def init_ui(self):
        central_widget = QWidget()
        self.setCentralWidget(central_widget)
        main_layout = QHBoxLayout(central_widget)

        # Splitter for List (Left) and Detail (Right)
        splitter = QSplitter(Qt.Horizontal)
        main_layout.addWidget(splitter)

        self.create_toolbar()

        # Left Panel: User List
        left_panel = QWidget()
        left_layout = QVBoxLayout(left_panel)
        
        # Search Box
        self.search_input = QLineEdit()
        self.search_input.setPlaceholderText("検索 (名前/ID/よみ)...")
        self.search_input.textChanged.connect(self.filter_list)
        left_layout.addWidget(self.search_input)

        # List Widget
        self.pc_list_widget = QListWidget()
        self.pc_list_widget.itemSelectionChanged.connect(self.on_selection_changed)
        left_layout.addWidget(self.pc_list_widget, 1) # Add stretch to list

        # Buttons (Add, Copy, Delete)
        btn_layout = QHBoxLayout()
        self.btn_add = QPushButton("新規作成")
        self.btn_copy = QPushButton("複製")
        self.btn_delete = QPushButton("削除")
        
        self.btn_add.clicked.connect(self.add_pc)
        self.btn_copy.clicked.connect(self.copy_pc)
        self.btn_delete.clicked.connect(self.delete_pc)
        
        btn_layout.addWidget(self.btn_add)
        btn_layout.addWidget(self.btn_copy)
        btn_layout.addWidget(self.btn_delete)
        left_layout.addLayout(btn_layout)
        
        # Save button also in layout for redundancy, but put in btn_layout or separate?
        # User said "Missing", so maybe they didn't see it at bottom. 
        # I'll put a big Save button in the layout too, but maybe with the other buttons?
        # Let's keep it separate but clear.
        self.btn_save = QPushButton("保存 (Save)")
        self.btn_save.setStyleSheet("""
            QPushButton {
                background-color: #4CAF50; 
                color: white; 
                font-weight: bold; 
                font-size: 16px; 
                height: 50px; 
                border-radius: 5px;
            }
            QPushButton:hover {
                background-color: #45a049;
            }
        """)
        self.btn_save.clicked.connect(self.save_data_click)
        left_layout.addWidget(self.btn_save)
        
        # Duplicate Toggle
        self.dup_check_box = QCheckBox("一時的に重複IDを許可")
        left_layout.addWidget(self.dup_check_box)

        splitter.addWidget(left_panel)
        splitter.setStretchFactor(0, 1)

        # Right Panel: Detail Editor
        self.editor = EditorWidget()
        self.editor.dataChanged.connect(self.on_data_changed)
        self.editor.idChangeRequested.connect(self.handle_id_change)
        
        # Scroll Area wrap
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setWidget(self.editor)
        splitter.addWidget(scroll)
        splitter.setStretchFactor(1, 3)

        # Initial List Load
        self.refresh_list()

    def create_toolbar(self):
        toolbar = self.addToolBar("Main Toolbar")
        toolbar.setMovable(False)
        toolbar.setToolButtonStyle(Qt.ToolButtonTextBesideIcon)
        toolbar.setStyleSheet("QToolBar { spacing: 10px; padding: 5px; } QToolButton { font-size: 14px; font-weight: bold; }")
        
        # Save Action
        save_action = QAction("保存 (Save)", self)
        save_action.setShortcut("Ctrl+S")
        save_action.setToolTip("変更を保存 (Ctrl+S)")
        save_action.triggered.connect(self.save_data_click)
        save_action.setIcon(self.style().standardIcon(QStyle.SP_DialogSaveButton))
        toolbar.addAction(save_action)
        
        toolbar.addSeparator()
        
        # Add Actions
        add_action = QAction("新規作成", self)
        add_action.setShortcut("Ctrl+N")
        add_action.setToolTip("新規PCを作成 (Ctrl+N)")
        add_action.triggered.connect(self.add_pc)
        toolbar.addAction(add_action)

    def refresh_list(self):
        current_id = self.current_pc_id
        search_text = self.search_input.text().lower()
        
        # Sort PCs by ID descending
        def get_id_num(pc):
            pid = pc.get('id', '')
            match = re.search(r'(\d+)', pid)
            return int(match.group(1)) if match else 0
            
        self.pcs.sort(key=get_id_num, reverse=True)
        
        self.pc_list_widget.blockSignals(True)
        self.pc_list_widget.clear()
        self.pc_list_widget.blockSignals(False)
        
        self.filtered_pcs = []
        for pc in self.pcs:
            name = pc.get('name', '').lower()
            pid = pc.get('id', '').lower()
            ruby = pc.get('ruby', '').lower()
            
            if not search_text or search_text in name or search_text in pid or search_text in ruby:
                self.filtered_pcs.append(pc)
                item = QListWidgetItem(f"{pc.get('name', 'No Name')} ({pc.get('id', 'No ID')})")
                item.setData(Qt.UserRole, pc['id']) # Store ID only to avoid copy issues
                self.pc_list_widget.addItem(item)
                
        if pc['id'] == current_id:
                    self.pc_list_widget.setCurrentItem(item)

        # If no current_id and we have items (e.g. startup), select first
        if not current_id and self.pc_list_widget.count() > 0:
            self.pc_list_widget.setCurrentRow(0)

    def filter_list(self):
        self.refresh_list()
        # If selection cleared due to filter, clear editor?
        if not self.pc_list_widget.selectedItems():
            self.editor.set_pc({})
            self.editor.setEnabled(False)
        else:
            self.editor.setEnabled(True)

    def check_unsaved_changes(self):
        """Checks for unsaved changes. Returns True if safe to proceed, False if cancelled."""
        if not self.is_dirty:
            return True
            
        ret = QMessageBox.question(self, "未保存の変更", 
                                   "変更が保存されていません。\n保存しますか？",
                                   QMessageBox.Yes | QMessageBox.No | QMessageBox.Cancel)
        
        if ret == QMessageBox.Yes:
            return self.save_data_click() # Returns True if saved success
        elif ret == QMessageBox.No:
            # Discard changes: Reload data from disk to revert memory changes
            self.pcs = self.data_manager.load_data()
            self.refresh_list()
            self.is_dirty = False
            self.update_title()
            return True
        else:
            return False # Cancel

    def on_selection_changed(self):
        if self.ignore_selection_change:
            return

        # New selection
        items = self.pc_list_widget.selectedItems()
        new_id = items[0].data(Qt.UserRole) if items else None
        
        if new_id == self.current_pc_id:
             return

        # Check if current PC name is empty
        if self.current_pc_id:
            current_pc = next((p for p in self.pcs if p['id'] == self.current_pc_id), None)
            if current_pc and not current_pc.get('name', '').strip():
                QMessageBox.warning(self, "入力エラー", "探索者名は必須です。")
                self.ignore_selection_change = True
                self.restore_selection(self.current_pc_id)
                self.ignore_selection_change = False
                return

        # Check for unsaved changes on the PREVIOUS PC
        if self.is_dirty:
            self.ignore_selection_change = True # Prevent recursion
            if not self.check_unsaved_changes():
                # Cancelled: Revert selection
                self.restore_selection(self.current_pc_id)
                self.ignore_selection_change = False
                return
            self.ignore_selection_change = False
            
            # If "No" (Discard) was chosen, the list might have been refreshed.
            # We need to find the new item corresponding to `new_id` (if it still exists)
            # If "Yes" (Saved), we proceed.

        # Proceed to switch
        if not items and self.pc_list_widget.selectedItems():
             # Logic if refresh happened
             items = self.pc_list_widget.selectedItems()
             new_id = items[0].data(Qt.UserRole)

        self.current_pc_id = new_id
        
        if new_id:
            # Find PC object by ID
            pc_obj = next((p for p in self.pcs if p['id'] == new_id), None)
            if pc_obj:
                self.editor.setEnabled(True)
                self.editor.set_pc(pc_obj)
            else:
                self.editor.set_pc({})
                self.editor.setEnabled(False)
        else:
            self.editor.set_pc({})
            self.editor.setEnabled(False)

    def restore_selection(self, pc_id):
        self.pc_list_widget.blockSignals(True)
        found = False
        for i in range(self.pc_list_widget.count()):
            item = self.pc_list_widget.item(i)
            if item.data(Qt.UserRole) == pc_id:
                self.pc_list_widget.setCurrentItem(item)
                found = True
                break
        if not found:
            self.pc_list_widget.clearSelection() # Should not happen usually
        self.pc_list_widget.blockSignals(False)

    def on_data_changed(self):
        if not self.is_dirty:
            self.is_dirty = True
            self.update_title()
        
        # Update list item text immediately
        current_row = self.pc_list_widget.currentRow()
        if current_row >= 0:
            item = self.pc_list_widget.item(current_row)
            # Get updated data from editor's current_pc
            # We assume editor is editing the right object ref
            pc = self.editor.current_pc
            if pc:
                item.setText(f"{pc.get('name', 'No Name')} ({pc.get('id', 'No ID')})")
                new_id = pc.get('id')
                item.setData(Qt.UserRole, new_id) # Update ID if changed
                self.current_pc_id = new_id # Keep track of current ID in case it changed
        
        # Auto-save
        self.auto_save()

    def update_title(self):
        title = "TRPG Profile - PC Manager"
        if self.is_dirty:
            title += " *"
        self.setWindowTitle(title)

    def add_pc(self):
        if not self.check_unsaved_changes():
            return
            
        new_id = self.data_manager.generate_new_id()
        new_pc = {
            "id": new_id,
            "name": "",
            "ruby": "",
            "image_icon": "",
            "image_main": "",
            "images_diff": [],
            "profile": {
                "gender": "",
                "age": "",
                "height": "",
                "job": ""
            },
            "passed_scenarios": [],
            "arts": [],
            "created_at": datetime.date.today().isoformat()
        }
        self.pcs.insert(0, new_pc)
        self.refresh_list()
        self.pc_list_widget.setCurrentRow(0) # Triggers selection change -> sets current_pc_id
        self.is_dirty = True # Adding is a change
        self.update_title()
        
        # Focus Name Input
        self.editor.inp_name.setFocus()

    def handle_id_change(self, old_id, new_id):
        # Find objects
        current_pc = next((p for p in self.pcs if p['id'] == old_id), None)
        if not current_pc:
             # Should not happen
             self.editor.set_pc(self.editor.current_pc) 
             return

        target_pc = next((p for p in self.pcs if p['id'] == new_id), None)

        if target_pc and target_pc != current_pc:
            # Duplicate
            ret = QMessageBox.warning(self, "ID重複", 
                                      f"ID {new_id} は既に存在します。\n「{target_pc.get('name')}」と入れ替えますか？",
                                      QMessageBox.Yes | QMessageBox.No)
            if ret == QMessageBox.Yes:
                self.perform_pc_swap(current_pc, target_pc)
            else:
                # Revert UI
                self.editor.set_pc(current_pc) 
        else:
            # Rename
            self.perform_pc_rename(current_pc, new_id)
            
    def perform_pc_rename(self, pc, new_id):
        old_id = pc['id']
        
        if ImageManager.rename_assets(old_id, new_id):
            pc['id'] = new_id
            self.update_paths_for_id(pc, old_id, new_id)
            self.is_dirty = True
            
            self.refresh_list()
            self.select_pc_by_id(new_id)
        else:
            QMessageBox.critical(self, "エラー", "フォルダのリネームに失敗しました。")
            self.editor.set_pc(pc)

    def perform_pc_swap(self, pc1, pc2):
        id1 = pc1['id']
        id2 = pc2['id']
        
        if ImageManager.swap_assets(id1, id2):
            pc1['id'] = id2
            pc2['id'] = id1
            
            self.update_paths_for_id(pc1, id1, id2)
            self.update_paths_for_id(pc2, id2, id1)
            
            self.is_dirty = True
            
            self.refresh_list()
            self.select_pc_by_id(id2) # Select pc1's new ID
        else:
             QMessageBox.critical(self, "エラー", "フォルダの入れ替えに失敗しました。")
             self.editor.set_pc(pc1)

    def update_paths_for_id(self, pc, old_id, new_id):
        def replace_path(path):
            if not path: return ""
            return path.replace(f"/pcs/{old_id}/", f"/pcs/{new_id}/")

        pc['image_icon'] = replace_path(pc.get('image_icon'))
        pc['image_main'] = replace_path(pc.get('image_main'))
        
        if 'images_diff' in pc:
            pc['images_diff'] = [replace_path(p) for p in pc['images_diff']]
            
        if 'arts' in pc:
            for art in pc['arts']:
                art['url'] = replace_path(art.get('url'))

    def select_pc_by_id(self, pc_id):
        self.current_pc_id = pc_id
        for i in range(self.pc_list_widget.count()):
            item = self.pc_list_widget.item(i)
            if item.data(Qt.UserRole) == pc_id:
                self.pc_list_widget.setCurrentItem(item)
                break
        pc = next((p for p in self.pcs if p['id'] == pc_id), None)
        if pc:
            self.editor.set_pc(pc)

    def copy_pc(self):
        if not self.check_unsaved_changes():
            return
            
        items = self.pc_list_widget.selectedItems()
        if not items: return
        
        # Get Source PC
        src_id = items[0].data(Qt.UserRole)
        src_pc = next((p for p in self.pcs if p['id'] == src_id), None)
        if not src_pc: return

        new_pc = json.loads(json.dumps(src_pc))
        new_pc['id'] = self.data_manager.generate_new_id() 
        new_pc['name'] += " (コピー)"
        new_pc['created_at'] = datetime.date.today().isoformat()
        
        self.pcs.insert(0, new_pc)
        self.refresh_list()
        self.pc_list_widget.setCurrentRow(0)
        self.is_dirty = True
        self.update_title()

    def delete_pc(self):
        items = self.pc_list_widget.selectedItems()
        if not items: return
        
        pc_id = items[0].data(Qt.UserRole)
        pc = next((p for p in self.pcs if p['id'] == pc_id), None)
        if not pc: return

        ret = QMessageBox.question(self, "削除確認", 
                                   f"探索者: {pc.get('name')} を削除しますか？\n\n登録されている画像フォルダもゴミ箱へ移動します。",
                                   QMessageBox.Yes | QMessageBox.No)
        if ret == QMessageBox.Yes:
            if pc.get('id'):
                pc_dir = ASSETS_DIR / pc['id']
                if pc_dir.exists():
                     timestamp = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
                     trash_path = TRASH_DIR / f"{timestamp}__{pc['id']}_folder"
                     try:
                         shutil.move(pc_dir, trash_path)
                     except Exception as e:
                         print(f"Error moving folder to trash: {e}")

            self.pcs.remove(pc)
            self.refresh_list() # Clears selection
            self.is_dirty = True
            self.update_title()
            
            # Select first item if available
            if self.pc_list_widget.count() > 0:
                self.pc_list_widget.setCurrentRow(0)
            else:
                self.current_pc_id = None
                self.editor.set_pc({})
                self.editor.setEnabled(False)

    def auto_save(self):
        """自動保存処理"""
        allow_dup = self.dup_check_box.isChecked()
        ret, msg = self.data_manager.save_data(self.pcs, allow_dup)
        if ret:
            self.is_dirty = False
            self.update_title()
            self.statusBar().showMessage("自動保存しました", 2000)
        else:
            # エラーは静かに記録(ポップアップは出さない)
            print(f"Auto-save failed: {msg}")

    def save_data_click(self):
        allow_dup = self.dup_check_box.isChecked()
        ret, msg = self.data_manager.save_data(self.pcs, allow_dup)
        if ret:
            self.is_dirty = False
            self.update_title()
            self.statusBar().showMessage("データを保存しました", 3000) # Show for 3 seconds
            return True
        else:
            QMessageBox.critical(self, "保存エラー", msg) # Error still warrants a pop-up
            return False

    def closeEvent(self, event):
        if not self.check_unsaved_changes():
            event.ignore()
        else:
            event.accept()

if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = MainWindow()
    window.show()
    sys.exit(app.exec())
