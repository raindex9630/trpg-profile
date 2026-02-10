import json
import shutil
import os
from pathlib import Path
import re

PROJECT_ROOT = Path(__file__).parent.parent
DATA_FILE = PROJECT_ROOT / 'data/pcs.json'
ASSETS_DIR = PROJECT_ROOT / 'data/assets/pcs'

def migrate():
    if not DATA_FILE.exists():
        print("Data file not found.")
        return

    with open(DATA_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    # Backup
    shutil.copy2(DATA_FILE, str(DATA_FILE) + ".bak_migration")
    print(f"Backup created at {DATA_FILE}.bak_migration")
    
    # Process
    for pc in data:
        old_id = pc.get('id', '')
        # Check if ID is in old format (starts with 'pc') OR if we just want to ensure it's 3-digit number
        # User requested filtering: "pc001" -> "001"
        # If it's already "001", we might still need to check if folder structure is correct?
        # Assuming we are migrating from "pcXXX"
        
        if not old_id: continue

        match = re.search(r'(\d+)', old_id)
        if not match:
            continue
        
        num = int(match.group(1))
        new_id = f"{num:03d}"
        
        # If ID is already correct format (e.g. "001") and folder is "001", do nothing?
        # But if ID is "pc001", we change to "001" and rename folder.
        
        if old_id == new_id:
            # ID is already numeric string (e.g. "006")
            # But check if folder is "pc006" (legacy folder with new ID?)
            # Or assume if ID is "006", folder is "006".
            # For this migration, we primarily target "pc" prefix in ID.
            continue
            
        print(f"Migrating {old_id} -> {new_id}")
        
        # Rename Folder
        # Try finding folder with old ID
        old_dir = ASSETS_DIR / old_id
        new_dir = ASSETS_DIR / new_id
        
        if old_dir.exists():
            if new_dir.exists():
                    print(f"Warning: Target directory {new_dir} already exists. Merging/Skipping rename.")
            else:
                    try:
                        old_dir.rename(new_dir)
                        print(f"Renamed directory: {old_id} -> {new_id}")
                    except Exception as e:
                        print(f"Error renaming directory: {e}")
        else:
            # If old folder doesn't exist, maybe it was already renamed or never existed?
            # Check if new folder exists?
            pass
        
        # Update Paths in JSON
        def update_path(path):
            if not path: return path
            # Path usually starts with "data/assets/pcs/pcXXX/..."
            # We want to replace "/pcXXX/" with "/XXX/"
            
            # Use strict replacement to avoid accidents
            # Normalize separators
            p = path.replace('\\', '/')
            search_str = f"/pcs/{old_id}/"
            replace_str = f"/pcs/{new_id}/"
            
            if search_str in p:
                return p.replace(search_str, replace_str)
            return p

        pc['image_icon'] = update_path(pc.get('image_icon'))
        pc['image_main'] = update_path(pc.get('image_main'))
        
        if 'images_diff' in pc:
            pc['images_diff'] = [update_path(p) for p in pc['images_diff']]
        
        if 'arts' in pc:
            for art in pc['arts']:
                art['url'] = update_path(art.get('url'))
        
        # Finally update ID
        pc['id'] = new_id

    # Save
    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=4, ensure_ascii=False)
    
    print("Migration completed.")

if __name__ == "__main__":
    migrate()
