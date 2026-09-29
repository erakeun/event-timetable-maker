from pathlib import Path
from pypdf import PdfReader
import pdfplumber,json,re,datetime,logging
logging.getLogger("pdfminer").setLevel(logging.ERROR)
root=Path.cwd(); evidence=json.loads((root/'docs/qa/large-print-browser.json').read_text()); results=[]
for filename,expected_width,expected_height in [('large-a3.pdf',841.89,1190.55),('large-a4-portrait.pdf',595.28,841.89)]:
    path=root/'docs/qa'/filename; reader=PdfReader(path); pages=[]; all_normalized=[]
    with pdfplumber.open(path) as pdf:
        for i,page in enumerate(reader.pages):
            text=page.extract_text() or ''; normalized=re.sub(r'\s+','',text); all_normalized.append(normalized)
            width=float(page.mediabox.width); height=float(page.mediabox.height); chars=pdf.pages[i].chars
            outside=[{'text':c['text'],'x0':c['x0'],'x1':c['x1'],'top':c['top'],'bottom':c['bottom']} for c in chars if c['x0'] < -1 or c['x1'] > width+1 or c['top'] < -1 or c['bottom'] > height+1]
            markers=[m for m in evidence['expectedRowMarkers'] if m in normalized]
            assert abs(width-expected_width)<2 and abs(height-expected_height)<2,(filename,'paper size',width,height)
            assert markers,(filename,'blank or rowless page',i+1,text)
            assert all(h in normalized for h in ['이름','일시','장소','역할']),(filename,'missing repeated table header',i+1)
            assert not outside,(filename,'text outside page',i+1,outside)
            assert 'INTERNAL_SHOULD_NOT_PRINT' not in text
            pages.append({'page':i+1,'widthPt':width,'heightPt':height,'textCharacters':len(text),'rowMarkers':markers,'minFontPt':min(c['size'] for c in chars),'repeatedTableHeader':True,'outsideTextCount':len(outside)})
    assert len(reader.pages)>1,(filename,'multi-page printing expected')
    missing=[m for m in evidence['expectedRowMarkers'] if sum(m in text for text in all_normalized)!=1]
    split_names=[name for name in evidence['expectedNames'] if not any(re.sub(r'\s+','',name) in text for text in all_normalized)]
    assert not missing,(filename,'missing/repeated marker',missing)
    assert not split_names,(filename,'name missing or split over pages',split_names)
    results.append({'file':filename,'physicalPages':len(reader.pages),'completeNamesOnOnePage':True,'all42RowMarkersExactlyOnce':True,'internalNoteExcluded':True,'pages':pages})
output={'recordedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'parser':'pypdf + pdfplumber','checks':'Physical dimensions, per-page repeated header, all 42 names intact on one page, unique row markers, no text outside paper, no blank/rowless page, internal note excluded','pdfs':results,'visualInspection':'Pending PNG rendering and model visual inspection'}
(root/'docs/qa/large-print-inspection.json').write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(output,ensure_ascii=False,indent=2))
