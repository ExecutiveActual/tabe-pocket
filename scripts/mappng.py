import json,sys
from PIL import Image
d=json.load(open('${process.argv[2] || 'data/tabe.json'}'))
C={'~':(42,93,124),'.':(217,197,139),',':(122,163,90),'J':(47,100,45),'o':(196,160,100),'m':(80,110,80),'h':(140,130,100),'^':(110,105,100),'p':(74,134,168),'s':(91,156,192)}
rows=d['rows'];n=len(rows)
im=Image.new('RGB',(n,n))
px=im.load()
for y,r in enumerate(rows):
  for x,c in enumerate(r): px[x,y]=C[c]
x,y=d['landing']
for dx in range(-4,5):
  for dy in range(-4,5): px[x+dx,y+dy]=(255,0,0)
for x,y in d['rookeries']:
  for dx in range(-4,5):
    for dy in range(-4,5): px[x+dx,y+dy]=(255,255,0)
im.save(sys.argv[1] if len(sys.argv)>1 else 'shots/map.png')
