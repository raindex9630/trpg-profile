import json
import os
from PIL import Image
import sys

# プロジェクトルートディレクトリ（このスクリプトは tools/ にあると仮定）
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, 'data')
PCS_JSON = os.path.join(DATA_DIR, 'pcs.json')

def optimize_image(image_path, max_size=(200, 200)):
    """
    画像をリサイズしてWebPに変換する。
    元のファイルは削除する。
    新しいWebPファイルのパス（プロジェクトルートからの相対パス）を返す。
    """
    full_path = os.path.join(BASE_DIR, image_path)
    
    if not os.path.exists(full_path):
        print(f"Warning: File not found {full_path}")
        return image_path

    # すでにWebPならリサイズだけ確認して終了（今回は単純化のため拡張子で判断）
    # しかし「元画像を削除」が要件なので、png/jpgなら変換必須。
    
    filename, ext = os.path.splitext(full_path)
    if ext.lower() == '.webp':
        # WebPでもサイズ確認はすべきだが、今回は変換対象を主とする
        return image_path

    try:
        with Image.open(full_path) as img:
            # アスペクト比を維持してリサイズ
            img.thumbnail(max_size)
            
            # WebPとして保存
            new_full_path = filename + '.webp'
            img.save(new_full_path, 'WEBP', quality=80)
            print(f"Converted: {image_path} -> {os.path.basename(new_full_path)}")

        # 元画像を削除
        os.remove(full_path)
        print(f"Deleted original: {image_path}")
        
        # 新しいパスを返す (相対パス)
        new_rel_path = os.path.relpath(new_full_path, BASE_DIR).replace('\\', '/')
        return new_rel_path

    except Exception as e:
        print(f"Error processing {image_path}: {e}")
        return image_path

def main():
    print(f"Loading {PCS_JSON}...")
    with open(PCS_JSON, 'r', encoding='utf-8') as f:
        pcs = json.load(f)

    updated = False
    for pc in pcs:
        if 'image_icon' in pc and pc['image_icon']:
            original_path = pc['image_icon']
            new_path = optimize_image(original_path, max_size=(200, 200))
            if new_path != original_path:
                pc['image_icon'] = new_path
                updated = True

    if updated:
        print(f"Updating {PCS_JSON}...")
        with open(PCS_JSON, 'w', encoding='utf-8') as f:
            json.dump(pcs, f, ensure_ascii=False, indent=4)
        print("Done.")
    else:
        print("No changes needed.")

if __name__ == '__main__':
    main()
