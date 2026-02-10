import json
import pathlib
import sys

# Define paths
PROJECT_ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA_FILE = PROJECT_ROOT / "data/pcs.json"

def migrate_height():
    if not DATA_FILE.exists():
        print(f"Data file not found: {DATA_FILE}")
        return

    try:
        with open(DATA_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception as e:
        print(f"Error loading JSON: {e}")
        return

    updated_count = 0
    
    for pc in data:
        profile = pc.get('profile', {})
        height = profile.get('height', '')
        
        # Check if height exists, is not empty, and doesn't end with "cm"
        if height and not height.endswith('cm'):
            # Update height with "cm"
            new_height = f"{height}cm"
            profile['height'] = new_height
            updated_count += 1
            print(f"Updated PC {pc.get('id', 'Unknown')}: {height} -> {new_height}")

    if updated_count > 0:
        try:
            with open(DATA_FILE, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=4)
            print(f"Successfully updated {updated_count} PCs.")
        except Exception as e:
            print(f"Error saving JSON: {e}")
    else:
        print("No updates needed.")

if __name__ == "__main__":
    migrate_height()
