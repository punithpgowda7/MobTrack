import os
import sys
import pythoncom
import win32com.client

def export():
    pythoncom.CoInitialize()
    ppt_path = os.path.abspath(r"E:\PROJECTS\MobTrack\PPT\AURA+_Final_PPT.pptx")
    pdf_path = os.path.abspath(r"E:\PROJECTS\MobTrack\PPT\AURA+_Final_PPT.pdf")
    export_dir = os.path.abspath(r"E:\PROJECTS\MobTrack\PPT\slide_exports")

    os.makedirs(export_dir, exist_ok=True)

    print("Launching PowerPoint Application...")
    ppt_app = win32com.client.DispatchEx("PowerPoint.Application")
    try:
        print(f"Opening presentation: {ppt_path}")
        presentation = ppt_app.Presentations.Open(ppt_path, WithWindow=False)

        print(f"Exporting PDF to: {pdf_path}")
        # 32 = ppSaveAsPDF
        presentation.SaveAs(pdf_path, 32)
        print("PDF export successful.")

        print(f"Exporting Slide images to: {export_dir}")
        for i, slide in enumerate(presentation.Slides):
            slide_img_path = os.path.join(export_dir, f"Slide{i+1}.JPG")
            slide.Export(slide_img_path, "JPG", 1920, 1080)
            print(f"Exported Slide {i+1} to {slide_img_path}")

        presentation.Close()
        print("Done successfully!")
    finally:
        ppt_app.Quit()
        pythoncom.CoUninitialize()

if __name__ == "__main__":
    export()
