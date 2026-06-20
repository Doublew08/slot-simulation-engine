import os; from PIL import Image; asset_dir='docs/assets'; files=os.listdir(asset_dir); 
for f in files:
    if f.endswith('.jpg'):
        img = Image.open(os.path.join(asset_dir, f))
        img = img.resize((200, 200), Image.Resampling.LANCZOS)
        name = f.split('.')[0]
        img.save(os.path.join(asset_dir, name + '.webp'), 'WEBP', quality=85)
        os.remove(os.path.join(asset_dir, f))

