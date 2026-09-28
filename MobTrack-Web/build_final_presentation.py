import os
import pptx
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

def build_final_ppt():
    ppt_dir = r'E:\PROJECTS\MobTrack\PPT'
    template_name = 'SIH2026-IDEA-Presentation-Format.pptx'
    if not os.path.exists(os.path.join(ppt_dir, template_name)):
        template_name = 'SIH2026-IDEA-Presentation-Format (2).pptx'
    template_path = os.path.join(ppt_dir, template_name)
    output_pptx = os.path.join(ppt_dir, 'AURA+_Final_PPT.pptx')
    output_pdf = os.path.join(ppt_dir, 'AURA+_Final_PPT.pdf')
    
    # Asset paths
    assets_dir = os.path.join(ppt_dir, 'assets')
    team_logo_path = os.path.join(ppt_dir, 'team_logo.png')
    problem_img_path = os.path.join(assets_dir, 'problem_theft.jpg')
    solution_img_path = os.path.join(assets_dir, 'covert_tracking_solution.jpg')
    tech_logos_path = os.path.join(assets_dir, 'tech_stack_logos.jpg')
    web_mockup_path = os.path.join(assets_dir, 'web_dashboard_mockup.jpg')
    mobile_mockup_path = os.path.join(assets_dir, 'mobile_app_mockup.jpg')

    prs = pptx.Presentation(template_path)
    print(f"Loaded template with {len(prs.slides)} slides.")

    # Color Palette - Professional Aesthetic Light Theme (No gradients, no dark themes)
    NAVY_TITLE   = RGBColor(15, 23, 42)     # #0F172A
    SLATE_DARK   = RGBColor(30, 41, 59)     # #1E293B
    BODY_TEXT    = RGBColor(51, 65, 85)     # #334155
    BORDER_CARD  = RGBColor(203, 213, 225)  # #CBD5E1
    BG_CARD      = RGBColor(255, 255, 255)  # #FFFFFF
    
    # Accents & Tints
    BLUE_ACCENT  = RGBColor(29, 78, 216)    # #1D4ED8
    BLUE_TINT    = RGBColor(239, 246, 255)  # #EFF6FF
    BLUE_BORDER  = RGBColor(147, 197, 253)  # #93C5FD
    
    GREEN_ACCENT = RGBColor(21, 128, 61)    # #15803D
    GREEN_TINT   = RGBColor(240, 253, 244)  # #F0FDF4
    GREEN_BORDER = RGBColor(167, 243, 208)  # #A7F3D0

    AMBER_ACCENT = RGBColor(180, 83, 9)     # #B45309
    AMBER_TINT   = RGBColor(254, 243, 199)  # #FEF3C7
    AMBER_BORDER = RGBColor(253, 230, 138)  # #FDE68A

    RED_ACCENT   = RGBColor(185, 28, 28)    # #B91C1C
    RED_TINT     = RGBColor(254, 242, 242)  # #FEF2F2
    RED_BORDER   = RGBColor(254, 202, 202)  # #FECACA

    FONT_FAMILY  = 'Times New Roman'

    def format_slide_header_footer(slide, title_text, subtitle_text=None):
        # 1. Title formatting
        for s in slide.shapes:
            if s.name == 'Title 1':
                tf = s.text_frame
                tf.clear()
                tf.word_wrap = True
                p = tf.paragraphs[0]
                p.text = title_text
                p.font.name = FONT_FAMILY
                p.font.size = Pt(21)
                p.font.bold = True
                p.font.color.rgb = NAVY_TITLE
                p.alignment = PP_ALIGN.LEFT
                
                if subtitle_text:
                    p2 = tf.add_paragraph()
                    p2.text = subtitle_text
                    p2.font.name = FONT_FAMILY
                    p2.font.size = Pt(11.5)
                    p2.font.bold = False
                    p2.font.color.rgb = BLUE_ACCENT
                    p2.alignment = PP_ALIGN.LEFT

                s.left = Inches(2.70)
                s.top = Inches(0.12)
                s.width = Inches(7.50)
                s.height = Inches(0.95)

        # 2. Footer formatting
        for s in slide.shapes:
            if 'Footer' in s.name:
                tf = s.text_frame
                tf.clear()
                p = tf.paragraphs[0]
                p.text = "@ AURA+ | Smart India Hackathon 2026"
                p.font.name = FONT_FAMILY
                p.font.size = Pt(11)
                p.font.bold = True
                p.font.color.rgb = RGBColor(255, 255, 255)
                p.alignment = PP_ALIGN.LEFT

        # 3. Replace 'Oval' with Team Logo
        ovals = [s for s in slide.shapes if 'Oval' in s.name or s.name.startswith('Oval')]
        for ov in ovals:
            elem = ov.element
            elem.getparent().remove(elem)
        
        if os.path.exists(team_logo_path):
            slide.shapes.add_picture(team_logo_path, Inches(0.40), Inches(0.18), Inches(2.15), Inches(0.78))

        # 4. Remove placeholder 'TextBox 8'
        tbs = [s for s in slide.shapes if s.name == 'TextBox 8']
        for tb in tbs:
            elem = tb.element
            elem.getparent().remove(elem)

    def create_card_container(slide, left, top, width, height, title, header_bg, border_color, title_color=NAVY_TITLE):
        box = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, left, top, width, height)
        box.fill.solid()
        box.fill.fore_color.rgb = BG_CARD
        box.line.color.rgb = border_color
        box.line.width = Pt(1.5)

        header_h = Inches(0.34)
        header = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, left, top, width, header_h)
        header.fill.solid()
        header.fill.fore_color.rgb = header_bg
        header.line.color.rgb = border_color
        header.line.width = Pt(1.0)
        
        tf = header.text_frame
        tf.word_wrap = True
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        p = tf.paragraphs[0]
        p.text = f"  {title}"
        p.font.name = FONT_FAMILY
        p.font.size = Pt(11)
        p.font.bold = True
        p.font.color.rgb = title_color
        p.alignment = PP_ALIGN.LEFT

        content_top = top + header_h + Inches(0.04)
        content_h = height - header_h - Inches(0.08)
        return content_top, content_h

    def add_bullet_point(tf, bold_label, desc_text, is_first=False, font_size=10.0, label_color=BLUE_ACCENT):
        p = tf.paragraphs[0] if is_first else tf.add_paragraph()
        p.space_after = Pt(2.5)
        p.space_before = Pt(1.5)
        p.line_spacing = 1.15
        
        run1 = p.add_run()
        run1.text = f"•  {bold_label} : "
        run1.font.name = FONT_FAMILY
        run1.font.size = Pt(font_size)
        run1.font.bold = True
        run1.font.color.rgb = label_color
        
        run2 = p.add_run()
        run2.text = desc_text
        run2.font.name = FONT_FAMILY
        run2.font.size = Pt(font_size)
        run2.font.bold = False
        run2.font.color.rgb = BODY_TEXT

    # =========================================================================
    # SLIDE 2: MOBTRACK - PROPOSED SOLUTION & ARCHITECTURE (With Images)
    # =========================================================================
    print("Building Slide 2 (Humanized, Times New Roman 10pt, Images Integrated)...")
    s2 = prs.slides[1]
    format_slide_header_footer(s2, "MOBTRACK", "Smart Anti-Theft & Offline Device Recovery System")

    # Card 1: Problem Addressed (with Problem Illustration Image)
    c1_top, c1_h = create_card_container(s2, Inches(0.40), Inches(1.18), Inches(6.60), Inches(1.80),
                                         "HOW IT ADDRESSES THE PROBLEM (EXISTING CHALLENGES)", RED_TINT, RED_BORDER, RED_ACCENT)
    
    # Left text box inside Card 1 (width 4.35 in)
    tb_p = s2.shapes.add_textbox(Inches(0.48), c1_top, Inches(4.30), c1_h)
    tf_p = tb_p.text_frame
    tf_p.word_wrap = True
    tf_p.margin_left = tf_p.margin_right = tf_p.margin_top = tf_p.margin_bottom = Inches(0.02)
    add_bullet_point(tf_p, "Instant Thief Disarmament", "Thieves turn on Airplane Mode, remove the SIM, or power off the phone immediately to stop all tracking.", True, 10.0, RED_ACCENT)
    add_bullet_point(tf_p, "Internet Dependency Flaw", "Google Find My Device & Apple Find My stop working completely once mobile data and Wi-Fi are turned off.", False, 10.0, RED_ACCENT)
    add_bullet_point(tf_p, "Zero Suspect Evidence", "Traditional tools only show old map pins, leaving police with zero photo or audio evidence of the thief.", False, 10.0, RED_ACCENT)

    # Right image inside Card 1: problem_theft.jpg
    if os.path.exists(problem_img_path):
        s2.shapes.add_picture(problem_img_path, Inches(4.88), c1_top + Inches(0.04), Inches(2.02), Inches(1.30))

    # Card 2: Proposed Solution (with Solution Illustration Image)
    c2_top, c2_h = create_card_container(s2, Inches(0.40), Inches(3.08), Inches(6.60), Inches(1.92),
                                         "PROPOSED SOLUTION & PROTOTYPE DETAILS", BLUE_TINT, BLUE_BORDER, BLUE_ACCENT)
    
    # Left text box inside Card 2
    tb_s = s2.shapes.add_textbox(Inches(0.48), c2_top, Inches(4.25), c2_h)
    tf_s = tb_s.text_frame
    tf_s.word_wrap = True
    tf_s.margin_left = tf_s.margin_right = tf_s.margin_top = tf_s.margin_bottom = Inches(0.02)
    add_bullet_point(tf_s, "Dual-Channel Tracking", "Operates online via WebSockets and automatically falls back to an offline SMS Relay when data is off.", True, 10.0, BLUE_ACCENT)
    add_bullet_point(tf_s, "Fake Shutdown Trap", "Tricks the thief with a simulated shutdown screen while keeping GPS, camera, and mic active.", False, 10.0, BLUE_ACCENT)
    add_bullet_point(tf_s, "Stealth Intruder Proof", "Takes front/rear camera selfies and records ambient audio on wrong unlock attempts or remote triggers.", False, 10.0, BLUE_ACCENT)

    # Right image inside Card 2: covert_tracking_solution.jpg
    if os.path.exists(solution_img_path):
        s2.shapes.add_picture(solution_img_path, Inches(4.82), c2_top + Inches(0.04), Inches(2.08), Inches(1.38))

    # Card 3: Innovation & UVP
    c3_top, c3_h = create_card_container(s2, Inches(0.40), Inches(5.10), Inches(6.60), Inches(1.62),
                                         "INNOVATION & UNIQUENESS OF THE SOLUTION (UVP)", GREEN_TINT, GREEN_BORDER, GREEN_ACCENT)
    tb_u = s2.shapes.add_textbox(Inches(0.48), c3_top, Inches(6.44), c3_h)
    tf_u = tb_u.text_frame
    tf_u.word_wrap = True
    tf_u.margin_left = tf_u.margin_right = tf_u.margin_top = tf_u.margin_bottom = Inches(0.02)
    add_bullet_point(tf_u, "World's First Offline SMS Relay", "Track any offline device via basic SMS from any family phone without needing internet or mobile data.", True, 10.0, GREEN_ACCENT)
    add_bullet_point(tf_u, "Secret Hardware Button Escape", "Only the authentic owner can exit Fake Shutdown using a custom button combo (e.g. Vol Up + Vol Down).", False, 10.0, GREEN_ACCENT)
    add_bullet_point(tf_u, "Trustee Multi-Factor Recovery", "Verified friends and family can log in via instant OTP to track your device even if your laptop is lost.", False, 10.0, GREEN_ACCENT)

    # Right Column: System Architecture Box (Width 5.73 in, Height 5.54 in)
    arch_box = s2.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(7.20), Inches(1.18), Inches(5.73), Inches(5.54))
    arch_box.fill.solid()
    arch_box.fill.fore_color.rgb = BG_CARD
    arch_box.line.color.rgb = BORDER_CARD
    arch_box.line.width = Pt(1.5)

    arch_hdr = s2.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(7.20), Inches(1.18), Inches(5.73), Inches(0.34))
    arch_hdr.fill.solid()
    arch_hdr.fill.fore_color.rgb = RGBColor(241, 245, 249)
    arch_hdr.line.color.rgb = BORDER_CARD
    arch_hdr.line.width = Pt(1.0)
    p = arch_hdr.text_frame.paragraphs[0]
    p.text = "  SYSTEM ARCHITECTURE & STEALTH ENGINE"
    p.font.name = FONT_FAMILY
    p.font.size = Pt(11)
    p.font.bold = True
    p.font.color.rgb = NAVY_TITLE

    def add_arch_node(slide, x, y, w, h, title, subtitle, fill_c, border_c, title_c):
        node = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x, y, w, h)
        node.fill.solid()
        node.fill.fore_color.rgb = fill_c
        node.line.color.rgb = border_c
        node.line.width = Pt(1.0)
        tf = node.text_frame
        tf.word_wrap = True
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = Inches(0.02)
        p = tf.paragraphs[0]
        p.text = title
        p.font.name = FONT_FAMILY
        p.font.size = Pt(10)
        p.font.bold = True
        p.font.color.rgb = title_c
        p.alignment = PP_ALIGN.CENTER
        if subtitle:
            p2 = tf.add_paragraph()
            p2.text = subtitle
            p2.font.name = FONT_FAMILY
            p2.font.size = Pt(8.8)
            p2.font.bold = False
            p2.font.color.rgb = BODY_TEXT
            p2.alignment = PP_ALIGN.CENTER
        return node

    def add_down_arrow(slide, x, y):
        arrow = slide.shapes.add_shape(MSO_SHAPE.DOWN_ARROW, x, y, Inches(0.22), Inches(0.18))
        arrow.fill.solid()
        arrow.fill.fore_color.rgb = BLUE_ACCENT
        arrow.line.color.rgb = BLUE_BORDER
        arrow.line.width = Pt(0.5)

    add_arch_node(s2, Inches(8.30), Inches(1.60), Inches(3.50), Inches(0.54),
                  "👤 Owner / Police / Trustee Portal", "Web Dashboard or Emergency SMS",
                  RGBColor(248, 250, 252), BORDER_CARD, NAVY_TITLE)

    add_down_arrow(s2, Inches(9.94), Inches(2.18))

    add_arch_node(s2, Inches(8.30), Inches(2.40), Inches(3.50), Inches(0.48),
                  "⚡ Intelligent Connectivity Router", "Checks: Internet Available OR Offline?",
                  AMBER_TINT, AMBER_BORDER, AMBER_ACCENT)

    add_down_arrow(s2, Inches(9.94), Inches(2.92))

    add_arch_node(s2, Inches(7.35), Inches(3.14), Inches(2.65), Inches(0.88),
                  "🌐 ONLINE MODE (Cloud)", 
                  "• Supabase Realtime WebSocket\n• Live GPS Breadcrumbs\n• Live Audio & Video Feed",
                  BLUE_TINT, BLUE_BORDER, BLUE_ACCENT)

    add_arch_node(s2, Inches(10.15), Inches(3.14), Inches(2.65), Inches(0.88),
                  "📡 OFFLINE MODE (SMS Relay)", 
                  "• Standalone Relay Gateway\n• Encrypted SMS #track Ping\n• Fused GPS Auto-Fix Reply",
                  AMBER_TINT, AMBER_BORDER, AMBER_ACCENT)

    add_down_arrow(s2, Inches(9.94), Inches(4.06))

    add_arch_node(s2, Inches(7.35), Inches(4.28), Inches(5.45), Inches(0.85),
                  "🛡️ COVERT ACTIVE DEFENSE LAYER",
                  "• Fake Shutdown Service: Simulates power-off, locks buttons, keeps CPU awake\n• CameraX Intruder Burst: Front selfie on wrong PIN / remote trigger\n• Last-Gasp Telemetry: Emergency broadcast before battery dies (5%-25%)",
                  GREEN_TINT, GREEN_BORDER, GREEN_ACCENT)

    add_down_arrow(s2, Inches(9.94), Inches(5.17))

    add_arch_node(s2, Inches(7.35), Inches(5.38), Inches(5.45), Inches(0.58),
                  "🎯 RECOVERY & COURT-READY EVIDENCE",
                  "Live Radar Map Pin + Timestamped Intruder Photos + Audio Recordings + Remote Wipe",
                  RGBColor(241, 245, 249), BLUE_BORDER, BLUE_ACCENT)

    badges = [
        ("100% Offline Capable", BLUE_ACCENT),
        ("Zero Root Required", GREEN_ACCENT),
        ("End-to-End Scoped", BLUE_ACCENT),
        ("Battery Drain <1.5%", AMBER_ACCENT)
    ]
    b_w = Inches(1.30)
    b_gap = Inches(0.08)
    for idx, (b_txt, b_col) in enumerate(badges):
        bx = Inches(7.35) + idx * (b_w + b_gap)
        badge = s2.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, bx, Inches(6.05), b_w, Inches(0.32))
        badge.fill.solid()
        badge.fill.fore_color.rgb = RGBColor(255, 255, 255)
        badge.line.color.rgb = b_col
        badge.line.width = Pt(1.0)
        p = badge.text_frame.paragraphs[0]
        p.text = b_txt
        p.font.name = FONT_FAMILY
        p.font.size = Pt(8.5)
        p.font.bold = True
        p.font.color.rgb = b_col
        p.alignment = PP_ALIGN.CENTER

    # =========================================================================
    # SLIDE 3: TECHNICAL APPROACH (Flowcharts & Tech Stack Image)
    # =========================================================================
    print("Building Slide 3 (Flowcharts & Tech Logos Banner)...")
    s3 = prs.slides[2]
    format_slide_header_footer(s3, "TECHNICAL APPROACH", "Methodology, Implementation Process (Flow Charts) & Tech Stack")

    start_hdr = s3.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.40), Inches(1.18), Inches(12.53), Inches(0.36))
    start_hdr.fill.solid()
    start_hdr.fill.fore_color.rgb = RGBColor(241, 245, 249)
    start_hdr.line.color.rgb = BORDER_CARD
    start_hdr.line.width = Pt(1.0)
    p = start_hdr.text_frame.paragraphs[0]
    p.text = "METHODOLOGY & PROCESS FOR IMPLEMENTATION (FLOW CHARTS / WORKING PROTOTYPE)"
    p.font.name = FONT_FAMILY
    p.font.size = Pt(11)
    p.font.bold = True
    p.font.color.rgb = NAVY_TITLE
    p.alignment = PP_ALIGN.CENTER

    flow_col_w = Inches(4.04)
    flow_col_h = Inches(3.65)
    flow_y = Inches(1.60)

    # Column 1: Offline Relay Mode
    box_c1 = s3.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.40), flow_y, flow_col_w, flow_col_h)
    box_c1.fill.solid()
    box_c1.fill.fore_color.rgb = BG_CARD
    box_c1.line.color.rgb = AMBER_BORDER
    box_c1.line.width = Pt(1.5)

    hdr_c1 = s3.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.40), flow_y, flow_col_w, Inches(0.34))
    hdr_c1.fill.solid()
    hdr_c1.fill.fore_color.rgb = AMBER_TINT
    hdr_c1.line.color.rgb = AMBER_BORDER
    p = hdr_c1.text_frame.paragraphs[0]
    p.text = "  1. OFFLINE SMS RELAY FLOW"
    p.font.name = FONT_FAMILY
    p.font.size = Pt(10.5)
    p.font.bold = True
    p.font.color.rgb = AMBER_ACCENT

    c1_steps = [
        ("Step 1: Web / Trustee SMS", "Owner triggers #track <PIN> from Web or trustee phone."),
        ("Step 2: Relay Gateway", "MobTrack Relay forward-dispatches encrypted SMS command."),
        ("Step 3: Background Wakeup", "Native BroadcastReceiver intercepts SMS without turning screen on."),
        ("Step 4: Fused GPS Fix", "FusedLocationProviderClient pulls cold-fix GPS coordinates."),
        ("Step 5: Telemetry Reply", "Device dispatches encrypted SMS telemetry packet to Relay."),
        ("Step 6: Live Cloud Map Sync", "Relay pushes coordinates to Supabase -> Visualized on map!")
    ]
    for s_idx, (stitle, sdesc) in enumerate(c1_steps):
        sy = flow_y + Inches(0.38) + s_idx * Inches(0.47)
        step_node = s3.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.48), sy, flow_col_w - Inches(0.16), Inches(0.42))
        step_node.fill.solid()
        step_node.fill.fore_color.rgb = RGBColor(254, 252, 232)
        step_node.line.color.rgb = AMBER_BORDER
        step_node.line.width = Pt(0.75)
        tf = step_node.text_frame
        tf.word_wrap = True
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        p1 = tf.paragraphs[0]
        p1.text = f"▶ {stitle}"
        p1.font.name = FONT_FAMILY
        p1.font.size = Pt(9.5)
        p1.font.bold = True
        p1.font.color.rgb = AMBER_ACCENT
        p2 = tf.add_paragraph()
        p2.text = sdesc
        p2.font.name = FONT_FAMILY
        p2.font.size = Pt(8.5)
        p2.font.bold = False
        p2.font.color.rgb = BODY_TEXT

    r1 = s3.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.48), flow_y + Inches(3.28), flow_col_w - Inches(0.16), Inches(0.28))
    r1.fill.solid()
    r1.fill.fore_color.rgb = AMBER_ACCENT
    p = r1.text_frame.paragraphs[0]
    p.text = "✔ Device Located via SMS in 5-15 Seconds"
    p.font.name = FONT_FAMILY
    p.font.size = Pt(8.8)
    p.font.bold = True
    p.font.color.rgb = RGBColor(255, 255, 255)
    p.alignment = PP_ALIGN.CENTER

    # Column 2: Online Real-Time Mode
    box_c2 = s3.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(4.64), flow_y, flow_col_w, flow_col_h)
    box_c2.fill.solid()
    box_c2.fill.fore_color.rgb = BG_CARD
    box_c2.line.color.rgb = BLUE_BORDER
    box_c2.line.width = Pt(1.5)

    hdr_c2 = s3.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(4.64), flow_y, flow_col_w, Inches(0.34))
    hdr_c2.fill.solid()
    hdr_c2.fill.fore_color.rgb = BLUE_TINT
    hdr_c2.line.color.rgb = BLUE_BORDER
    p = hdr_c2.text_frame.paragraphs[0]
    p.text = "  2. ONLINE CLOUD STREAMING FLOW"
    p.font.name = FONT_FAMILY
    p.font.size = Pt(10.5)
    p.font.bold = True
    p.font.color.rgb = BLUE_ACCENT

    c2_steps = [
        ("Step 1: Dashboard Auth", "Owner logs in via password, backup code, or trustee OTP."),
        ("Step 2: Realtime Channel", "Web connects to Supabase Realtime low-latency WebSocket."),
        ("Step 3: Remote Action Triggers", "User dispatches commands: Siren Alarm, Take Photo, Record Mic."),
        ("Step 4: CameraX & Audio Service", "Covert foreground services capture intruder video and audio."),
        ("Step 5: Scoped Storage Upload", "Encrypted media stream uploads to private device storage bucket."),
        ("Step 6: Interactive Live Map", "Real-time breadcrumb history continuously plotted on map.")
    ]
    for s_idx, (stitle, sdesc) in enumerate(c2_steps):
        sy = flow_y + Inches(0.38) + s_idx * Inches(0.47)
        step_node = s3.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(4.72), sy, flow_col_w - Inches(0.16), Inches(0.42))
        step_node.fill.solid()
        step_node.fill.fore_color.rgb = RGBColor(239, 246, 255)
        step_node.line.color.rgb = BLUE_BORDER
        step_node.line.width = Pt(0.75)
        tf = step_node.text_frame
        tf.word_wrap = True
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        p1 = tf.paragraphs[0]
        p1.text = f"▶ {stitle}"
        p1.font.name = FONT_FAMILY
        p1.font.size = Pt(9.5)
        p1.font.bold = True
        p1.font.color.rgb = BLUE_ACCENT
        p2 = tf.add_paragraph()
        p2.text = sdesc
        p2.font.name = FONT_FAMILY
        p2.font.size = Pt(8.5)
        p2.font.bold = False
        p2.font.color.rgb = BODY_TEXT

    r2 = s3.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(4.72), flow_y + Inches(3.28), flow_col_w - Inches(0.16), Inches(0.28))
    r2.fill.solid()
    r2.fill.fore_color.rgb = BLUE_ACCENT
    p = r2.text_frame.paragraphs[0]
    p.text = "✔ Sub-Second Live Tracking & Photo Evidence"
    p.font.name = FONT_FAMILY
    p.font.size = Pt(8.8)
    p.font.bold = True
    p.font.color.rgb = RGBColor(255, 255, 255)
    p.alignment = PP_ALIGN.CENTER

    # Column 3: Fake Shutdown & Theft Interception
    box_c3 = s3.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(8.88), flow_y, flow_col_w, flow_col_h)
    box_c3.fill.solid()
    box_c3.fill.fore_color.rgb = BG_CARD
    box_c3.line.color.rgb = GREEN_BORDER
    box_c3.line.width = Pt(1.5)

    hdr_c3 = s3.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(8.88), flow_y, flow_col_w, Inches(0.34))
    hdr_c3.fill.solid()
    hdr_c3.fill.fore_color.rgb = GREEN_TINT
    hdr_c3.line.color.rgb = GREEN_BORDER
    p = hdr_c3.text_frame.paragraphs[0]
    p.text = "  3. FAKE SHUTDOWN & THEFT TRAP"
    p.font.name = FONT_FAMILY
    p.font.size = Pt(10.5)
    p.font.bold = True
    p.font.color.rgb = GREEN_ACCENT

    c3_steps = [
        ("Step 1: Power Button Held", "Thief holds power button to turn off phone and kill tracking."),
        ("Step 2: Accessibility Intercept", "FakeShutdownAccessibilityService catches system shutdown dialog."),
        ("Step 3: Fake Shutdown Animation", "Renders authentic power-down animation, then screen turns pitch black."),
        ("Step 4: Hardware Keys Locked", "Power/Volume clicks ignored; phone appears dead while CPU stays on!"),
        ("Step 5: Intruder Photo Burst", "Front camera automatically takes burst photos of the thief."),
        ("Step 6: Secret Button Sequence", "Owner restores device using secret sequence (e.g. Vol Up+Down).")
    ]
    for s_idx, (stitle, sdesc) in enumerate(c3_steps):
        sy = flow_y + Inches(0.38) + s_idx * Inches(0.47)
        step_node = s3.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(8.96), sy, flow_col_w - Inches(0.16), Inches(0.42))
        step_node.fill.solid()
        step_node.fill.fore_color.rgb = RGBColor(240, 253, 244)
        step_node.line.color.rgb = GREEN_BORDER
        step_node.line.width = Pt(0.75)
        tf = step_node.text_frame
        tf.word_wrap = True
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        p1 = tf.paragraphs[0]
        p1.text = f"▶ {stitle}"
        p1.font.name = FONT_FAMILY
        p1.font.size = Pt(9.5)
        p1.font.bold = True
        p1.font.color.rgb = GREEN_ACCENT
        p2 = tf.add_paragraph()
        p2.text = sdesc
        p2.font.name = FONT_FAMILY
        p2.font.size = Pt(8.5)
        p2.font.bold = False
        p2.font.color.rgb = BODY_TEXT

    r3 = s3.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(8.96), flow_y + Inches(3.28), flow_col_w - Inches(0.16), Inches(0.28))
    r3.fill.solid()
    r3.fill.fore_color.rgb = GREEN_ACCENT
    p = r3.text_frame.paragraphs[0]
    p.text = "✔ Thief Deceived & Trapped with Active GPS"
    p.font.name = FONT_FAMILY
    p.font.size = Pt(8.8)
    p.font.bold = True
    p.font.color.rgb = RGBColor(255, 255, 255)
    p.alignment = PP_ALIGN.CENTER

    # Bottom Tech Stack Box with REAL Brand Logos Image!
    ts_y = Inches(5.38)
    ts_h = Inches(1.36)
    ts_box = s3.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.40), ts_y, Inches(12.53), ts_h)
    ts_box.fill.solid()
    ts_box.fill.fore_color.rgb = BG_CARD
    ts_box.line.color.rgb = BORDER_CARD
    ts_box.line.width = Pt(1.5)

    ts_hdr = s3.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.40), ts_y, Inches(12.53), Inches(0.30))
    ts_hdr.fill.solid()
    ts_hdr.fill.fore_color.rgb = RGBColor(241, 245, 249)
    ts_hdr.line.color.rgb = BORDER_CARD
    p = ts_hdr.text_frame.paragraphs[0]
    p.text = "  TECHNOLOGIES TO BE USED (PROGRAMMING LANGUAGES, FRAMEWORKS, HARDWARE ARCHITECTURE)"
    p.font.name = FONT_FAMILY
    p.font.size = Pt(10)
    p.font.bold = True
    p.font.color.rgb = NAVY_TITLE

    # Embed tech_stack_logos.jpg on left (width 5.5 in)
    if os.path.exists(tech_logos_path):
        s3.shapes.add_picture(tech_logos_path, Inches(0.50), ts_y + Inches(0.38), Inches(5.80), Inches(0.90))

    # Tech stack detailed breakdown on right (width 6.4 in)
    ts_desc_box = s3.shapes.add_textbox(Inches(6.45), ts_y + Inches(0.34), Inches(6.35), Inches(0.96))
    tf_ts = ts_desc_box.text_frame
    tf_ts.word_wrap = True
    tf_ts.margin_left = tf_ts.margin_right = tf_ts.margin_top = tf_ts.margin_bottom = Inches(0.02)
    add_bullet_point(tf_ts, "Mobile Client", "React Native (Expo SDK 54), Kotlin Native Modules, CameraX API, Android Accessibility API, FusedLocationProvider.", True, 9.5, BLUE_ACCENT)
    add_bullet_point(tf_ts, "Web & Cloud", "Next.js 15 (App Router), TypeScript, Tailwind CSS, Leaflet Maps, Supabase Realtime & PostgreSQL Database.", False, 9.5, GREEN_ACCENT)
    add_bullet_point(tf_ts, "Relay & Telecom", "Standalone Android SMS Gateway, GSM Telemetry Engine, PDU Parser, In-App Over-The-Air (OTA) APK Updater.", False, 9.5, AMBER_ACCENT)

    # =========================================================================
    # SLIDE 4: FEASIBILITY AND VIABILITY (4 Grid Quadrants - Times New Roman 10pt)
    # =========================================================================
    print("Building Slide 4 (Feasibility & Viability - Times New Roman 10pt)...")
    s4 = prs.slides[3]
    format_slide_header_footer(s4, "FEASIBILITY AND VIABILITY", "Analysis of Feasibility, Viability, Potential Challenges & Mitigation Strategies")

    quad_w = Inches(6.15)
    quad_h = Inches(2.55)
    col1_x = Inches(0.40)
    col2_x = Inches(6.78)
    row1_y = Inches(1.18)
    row2_y = Inches(3.85)

    c_f_top, c_f_h = create_card_container(s4, col1_x, row1_y, quad_w, quad_h, "ANALYSIS OF THE FEASIBILITY OF THE IDEA", BLUE_TINT, BLUE_BORDER, BLUE_ACCENT)
    tb_feas = s4.shapes.add_textbox(col1_x + Inches(0.08), c_f_top, quad_w - Inches(0.16), c_f_h)
    tf_feas = tb_feas.text_frame
    tf_feas.word_wrap = True
    tf_feas.margin_left = tf_feas.margin_right = tf_feas.margin_top = tf_feas.margin_bottom = Inches(0.02)
    add_bullet_point(tf_feas, "Technical Proof", "Fully functional production APK (MobTrack v1.0.26) under 42 MB, tested and optimized for low RAM devices.", True, 10.0, BLUE_ACCENT)
    add_bullet_point(tf_feas, "Native Hardware Access", "Custom Kotlin modules for CameraX background capture, Accessibility Service, and SMS Gateway validated on Android 10-15.", False, 10.0, BLUE_ACCENT)
    add_bullet_point(tf_feas, "Operational Reliability", "Standby battery consumption is <1.5% per 24 hours using intelligent TaskManager triggers and displacement filters.", False, 10.0, BLUE_ACCENT)
    add_bullet_point(tf_feas, "Economic Practicality", "100% software-based solution. Zero hardware costs, zero external trackers to buy, and zero subscription barriers.", False, 10.0, BLUE_ACCENT)

    c_v_top, c_v_h = create_card_container(s4, col2_x, row1_y, quad_w, quad_h, "VIABILITY & MARKET SCALABILITY", GREEN_TINT, GREEN_BORDER, GREEN_ACCENT)
    tb_viab = s4.shapes.add_textbox(col2_x + Inches(0.08), c_v_top, quad_w - Inches(0.16), c_v_h)
    tf_viab = tb_viab.text_frame
    tf_viab.word_wrap = True
    tf_viab.margin_left = tf_viab.margin_right = tf_viab.margin_top = tf_viab.margin_bottom = Inches(0.02)
    add_bullet_point(tf_viab, "Massive Market Need", "Over 50,000+ smartphones are stolen daily globally. Over 80% are never recovered because thieves turn off data or power down.", True, 10.0, GREEN_ACCENT)
    add_bullet_point(tf_viab, "Policy & Police Alignment", "Directly complements government CEIR (Central Equipment Identity Register) portals and cyber police investigations.", False, 10.0, GREEN_ACCENT)
    add_bullet_point(tf_viab, "Business & Freemium Model", "Free essential anti-theft protection for citizens; premium tier for corporate fleet management, school tablets, and delivery personnel.", False, 10.0, GREEN_ACCENT)
    add_bullet_point(tf_viab, "Investment & High ROI", "Minimal server footprint via Supabase serverless edge; breaks even rapidly with exceptionally high operating margins.", False, 10.0, GREEN_ACCENT)

    c_tc_top, c_tc_h = create_card_container(s4, col1_x, row2_y, quad_w, Inches(2.82), "POTENTIAL CHALLENGES & RISKS (TECHNICAL) & STRATEGIES", AMBER_TINT, AMBER_BORDER, AMBER_ACCENT)
    tb_tc = s4.shapes.add_textbox(col1_x + Inches(0.08), c_tc_top, quad_w - Inches(0.16), c_tc_h)
    tf_tc = tb_tc.text_frame
    tf_tc.word_wrap = True
    tf_tc.margin_left = tf_tc.margin_right = tf_tc.margin_top = tf_tc.margin_bottom = Inches(0.02)
    add_bullet_point(tf_tc, "Risk: OS Battery Killing", "Aggressive Android OEM battery savers (MIUI, Samsung) may terminate background GPS and services in Doze mode.", True, 9.8, AMBER_ACCENT)
    add_bullet_point(tf_tc, "↳ Strategy / Mitigation", "Implemented persistent foreground services with low-priority notifications, system WAKELOCK, and Accessibility keepalive.", False, 9.8, GREEN_ACCENT)
    add_bullet_point(tf_tc, "Risk: Cellular Blindspots", "Stolen device moved to underground parking, basement, or metal container with zero cellular tower signal.", False, 9.8, AMBER_ACCENT)
    add_bullet_point(tf_tc, "↳ Strategy / Mitigation", "Local SQLite breadcrumb cache logs cell towers and last GPS; auto-flushes telemetry immediately once connection resumes.", False, 9.8, GREEN_ACCENT)

    c_uc_top, c_uc_h = create_card_container(s4, col2_x, row2_y, quad_w, Inches(2.82), "USER & OPERATIONAL CHALLENGES & STRATEGIES", RGBColor(238, 242, 255), RGBColor(199, 210, 254), BLUE_ACCENT)
    tb_uc = s4.shapes.add_textbox(col2_x + Inches(0.08), c_uc_top, quad_w - Inches(0.16), c_uc_h)
    tf_uc = tb_uc.text_frame
    tf_uc.word_wrap = True
    tf_uc.margin_left = tf_uc.margin_right = tf_uc.margin_top = tf_uc.margin_bottom = Inches(0.02)
    add_bullet_point(tf_uc, "Risk: Panic & Lost Passwords", "When a phone is stolen, the victim panics and does not have access to their computer or saved credentials.", True, 9.8, BLUE_ACCENT)
    add_bullet_point(tf_uc, "↳ Strategy / Mitigation", "Trustee Recovery system enables victims to log in from any friend's or family member's phone via instant OTP, or send direct SMS.", False, 9.8, GREEN_ACCENT)
    add_bullet_point(tf_uc, "Risk: SIM Card Ejection", "Thieves immediately eject the owner's SIM card to prevent incoming calls.", False, 9.8, BLUE_ACCENT)
    add_bullet_point(tf_uc, "↳ Strategy / Mitigation", "SIM Change Detection auto-captures the thief's new SIM phone number upon insertion and silently sends an alert SMS to trusted contacts.", False, 9.8, GREEN_ACCENT)

    # =========================================================================
    # SLIDE 5: IMPACT AND BENEFITS (Impacts, Comparison Table, 3 Modes)
    # =========================================================================
    print("Building Slide 5 (Impacts, Comparison Table, 3 Modes - Times New Roman 10pt)...")
    s5 = prs.slides[4]
    format_slide_header_footer(s5, "IMPACTS & BENEFITS", "Potential Impact on Audience, Benefits of Solution & Three Defense Modes")

    c_imp_top, c_imp_h = create_card_container(s5, Inches(0.40), Inches(1.18), Inches(5.95), Inches(2.45), 
                                               "POTENTIAL IMPACT ON TARGET AUDIENCE & SOCIETY", BLUE_TINT, BLUE_BORDER, BLUE_ACCENT)
    tb_imp = s5.shapes.add_textbox(Inches(0.48), c_imp_top, Inches(5.79), c_imp_h)
    tf_imp = tb_imp.text_frame
    tf_imp.word_wrap = True
    tf_imp.margin_left = tf_imp.margin_right = tf_imp.margin_top = tf_imp.margin_bottom = Inches(0.02)
    add_bullet_point(tf_imp, "Economic Asset Recovery", "Recovers stolen smartphones worth thousands of crores; collapses the stolen phone black market by turning stolen phones into active tracking beacons.", True, 10.0, BLUE_ACCENT)
    add_bullet_point(tf_imp, "Law Enforcement Empowerment", "Provides cyber police with court-ready forensic proof—high-res front camera photos of the thief, background audio clips, and precise GPS trails.", False, 10.0, BLUE_ACCENT)
    add_bullet_point(tf_imp, "Digital Privacy & Citizen Safety", "Stops identity theft, unauthorized UPI bank transactions, and blackmail by enabling instant remote lock and encrypted data wiping.", False, 10.0, BLUE_ACCENT)
    add_bullet_point(tf_imp, "Family Distress Protection", "Empowers students, women, and elderly citizens with automated emergency alerts and verified trustee location sharing during critical distress.", False, 10.0, BLUE_ACCENT)

    tbl_shape = s5.shapes.add_table(8, 4, Inches(6.55), Inches(1.18), Inches(6.38), Inches(2.45))
    tbl = tbl_shape.table
    tbl.columns[0].width = Inches(2.68)
    tbl.columns[1].width = Inches(1.20)
    tbl.columns[2].width = Inches(1.20)
    tbl.columns[3].width = Inches(1.30)

    table_data = [
        ("BENEFITS & FEATURE COMPARISON", "Google Find My", "Apple Find My", "MobTrack (AURA+)"),
        ("Offline GPS Tracking (No Data)", "❌ No", "❌ No", "✅ Full SMS Relay"),
        ("Fake Shutdown (Thief Trap)", "❌ No", "❌ No", "✅ Full Screen Lock"),
        ("Stealth Intruder Photo / Video", "❌ No", "❌ No", "✅ Front/Rear Cam"),
        ("Live Microphone Audio Feed", "❌ No", "❌ No", "✅ Real-time Mic"),
        ("Last-Gasp Low-Battery Alert", "⚠️ Last Ping", "⚠️ Last Ping", "✅ Auto GPS + Selfie"),
        ("Secret Hardware Button Unlock", "❌ No", "❌ No", "✅ Custom Sequence"),
        ("Trustee Friend Recovery OTP", "❌ Google ID", "⚠️ Family Only", "✅ Any Verified Friend")
    ]

    for row_idx, row in enumerate(table_data):
        for col_idx, text in enumerate(row):
            cell = tbl.cell(row_idx, col_idx)
            cell.text = text
            cell.margin_top = Inches(0.02)
            cell.margin_bottom = Inches(0.02)
            cell.margin_left = Inches(0.04)
            cell.margin_right = Inches(0.04)
            p = cell.text_frame.paragraphs[0]
            p.font.name = FONT_FAMILY
            cell.vertical_anchor = MSO_ANCHOR.MIDDLE
            
            if row_idx == 0:
                cell.fill.solid()
                cell.fill.fore_color.rgb = RGBColor(30, 58, 138)
                p.font.size = Pt(9.5)
                p.font.bold = True
                p.font.color.rgb = RGBColor(255, 255, 255)
                p.alignment = PP_ALIGN.CENTER if col_idx > 0 else PP_ALIGN.LEFT
            else:
                cell.fill.solid()
                if row_idx % 2 == 1:
                    cell.fill.fore_color.rgb = RGBColor(255, 255, 255)
                else:
                    cell.fill.fore_color.rgb = RGBColor(248, 250, 252)
                
                p.font.size = Pt(8.8)
                if col_idx == 0:
                    p.font.bold = True
                    p.font.color.rgb = SLATE_DARK
                    p.alignment = PP_ALIGN.LEFT
                elif col_idx == 3:
                    p.font.bold = True
                    p.font.color.rgb = GREEN_ACCENT
                    p.alignment = PP_ALIGN.CENTER
                else:
                    p.font.bold = False
                    p.font.color.rgb = RGBColor(185, 28, 28) if '❌' in text else RGBColor(180, 83, 9)
                    p.alignment = PP_ALIGN.CENTER

    bm_y = Inches(3.75)
    bm_box = s5.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.40), bm_y, Inches(12.53), Inches(2.95))
    bm_box.fill.solid()
    bm_box.fill.fore_color.rgb = BG_CARD
    bm_box.line.color.rgb = BORDER_CARD
    bm_box.line.width = Pt(1.5)

    bm_hdr = s5.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.40), bm_y, Inches(12.53), Inches(0.32))
    bm_hdr.fill.solid()
    bm_hdr.fill.fore_color.rgb = RGBColor(241, 245, 249)
    bm_hdr.line.color.rgb = BORDER_CARD
    p = bm_hdr.text_frame.paragraphs[0]
    p.text = "  HOW MOBTRACK WORKS - THREE DEPLOYMENT DEFENSE MODES"
    p.font.name = FONT_FAMILY
    p.font.size = Pt(10.5)
    p.font.bold = True
    p.font.color.rgb = NAVY_TITLE

    mode_w = Inches(4.04)
    mode_h = Inches(2.48)
    modes_data = [
        ("MODE 1: ONLINE (Working Device)", BLUE_TINT, BLUE_BORDER, BLUE_ACCENT, [
            ("For", "Device boots normally with active mobile data or Wi-Fi."),
            ("Process", "Web Dashboard -> Supabase Realtime -> Instant Live GPS + Video/Audio Stream."),
            ("Response Time", "< 1-2 seconds (Instant WebSocket sync)."),
            ("Success Rate", "99%+ real-time accuracy."),
            ("Best For", "Live radar navigation, siren alarms, and continuous intruder tracking.")
        ]),
        ("MODE 2: OFFLINE (Dead / No Internet)", AMBER_TINT, AMBER_BORDER, AMBER_ACCENT, [
            ("For", "Mobile data disabled, SIM removed, or out of internet coverage."),
            ("Process", "Web / Trustee -> Relay Gateway -> Encrypted #track SMS -> Device GPS reply."),
            ("Response Time", "5-15 seconds via GSM cellular towers."),
            ("Success Rate", "92-95% coverage anywhere cellular signals reach."),
            ("Best For", "Stolen phones with data turned off, basements, or remote travel.")
        ]),
        ("MODE 3: FAKE SHUTDOWN & LAST GASP", GREEN_TINT, GREEN_BORDER, GREEN_ACCENT, [
            ("For", "Thief attempts power-off OR battery drops below threshold (5%-25%)."),
            ("Process", "Screen blacked out + Camera burst + Emergency GPS packet dispatched."),
            ("Response Time", "0 ms (Instant hardware interception)."),
            ("Success Rate", "100% deception & evidence capture."),
            ("Best For", "Immediate theft interception, trapping thieves, and saving final location.")
        ])
    ]

    for m_idx, (m_title, m_bg, m_border, m_col, m_points) in enumerate(modes_data):
        mx = Inches(0.50) + m_idx * (mode_w + Inches(0.12))
        m_card = s5.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, mx, bm_y + Inches(0.38), mode_w, mode_h)
        m_card.fill.solid()
        m_card.fill.fore_color.rgb = m_bg
        m_card.line.color.rgb = m_border
        m_card.line.width = Pt(1.0)
        
        p_t = m_card.text_frame.paragraphs[0]
        p_t.text = m_title
        p_t.font.name = FONT_FAMILY
        p_t.font.size = Pt(10)
        p_t.font.bold = True
        p_t.font.color.rgb = m_col
        p_t.alignment = PP_ALIGN.LEFT
        p_t.space_after = Pt(3)

        for p_label, p_text in m_points:
            p_i = m_card.text_frame.add_paragraph()
            p_i.space_after = Pt(2)
            p_i.line_spacing = 1.12
            run_lbl = p_i.add_run()
            run_lbl.text = f"• {p_label} : "
            run_lbl.font.name = FONT_FAMILY
            run_lbl.font.size = Pt(9.2)
            run_lbl.font.bold = True
            run_lbl.font.color.rgb = m_col
            run_val = p_i.add_run()
            run_val.text = p_text
            run_val.font.name = FONT_FAMILY
            run_val.font.size = Pt(9.0)
            run_val.font.bold = False
            run_val.font.color.rgb = BODY_TEXT

    # =========================================================================
    # SLIDE 6: RESEARCH AND REFERENCES (With 2 Working UI Mockup Images!)
    # =========================================================================
    print("Building Slide 6 (Research, Comparative & Real UI Mockup Images)...")
    s6 = prs.slides[5]
    format_slide_header_footer(s6, "RESEARCH AND REFERENCES", "Details / Links of Reference & Research Work, Comparative Benchmarks & Prototype")

    c_r_top, c_r_h = create_card_container(s6, Inches(0.40), Inches(1.14), Inches(12.53), Inches(1.52), 
                                           "DETAILS / LINKS OF THE REFERENCE AND RESEARCH WORK", BLUE_TINT, BLUE_BORDER, BLUE_ACCENT)
    tb_res = s6.shapes.add_textbox(Inches(0.48), c_r_top, Inches(12.35), c_r_h)
    tf_res = tb_res.text_frame
    tf_res.word_wrap = True
    tf_res.margin_left = tf_res.margin_right = tf_res.margin_top = tf_res.margin_bottom = Inches(0.02)
    add_bullet_point(tf_res, "3GPP Cellular Telemetry Standards", "Built in compliance with 3GPP TS 23.040 for Point-to-Point Short Message Service (SMS) PDU transmission without data bearer dependencies.", True, 9.5, BLUE_ACCENT)
    add_bullet_point(tf_res, "Android OS Security Architecture", "Follows Google Android Open Source Project (AOSP) documentation on Accessibility Services and Foreground Service lifecycles for legal, reliable execution.", False, 9.5, BLUE_ACCENT)
    add_bullet_point(tf_res, "National Cyber Crime & CEIR Integration", "Grounded in NCRB telemetry (50k+ phones stolen daily in India); streams verified IMEI & GPS into Central Equipment Identity Register (CEIR).", False, 9.5, BLUE_ACCENT)
    add_bullet_point(tf_res, "Battery & Sensor Efficiency Studies", "Utilizes Google FusedLocationProviderClient with displacement filters and geofence throttling, reducing standby battery consumption to under 1.5% per 24 hours.", False, 9.5, BLUE_ACCENT)

    comp_y = Inches(2.76)
    comp_w = Inches(5.80)
    comp_h = Inches(1.70)

    c_ex_top, c_ex_h = create_card_container(s6, Inches(0.40), comp_y, comp_w, comp_h, 
                                             "SOLUTIONS ALREADY EXIST (Google / Apple / Prey)", RED_TINT, RED_BORDER, RED_ACCENT)
    tb_ex = s6.shapes.add_textbox(Inches(0.48), c_ex_top, comp_w - Inches(0.16), c_ex_h)
    tf_ex = tb_ex.text_frame
    tf_ex.word_wrap = True
    tf_ex.margin_left = tf_ex.margin_right = tf_ex.margin_top = tf_ex.margin_bottom = Inches(0.02)
    add_bullet_point(tf_ex, "Internet Dependent", "Require active mobile data or dense Bluetooth mesh; fail completely when phone is taken to rural or offline areas.", True, 9.8, RED_ACCENT)
    add_bullet_point(tf_ex, "Bypassed in Seconds", "Thieves easily neutralize protection by sliding notification shade to enable Airplane Mode or powering off.", False, 9.8, RED_ACCENT)
    add_bullet_point(tf_ex, "Zero Suspect Evidence", "Provide no photos or audio of the thief; law enforcement has no leads to track the criminal.", False, 9.8, RED_ACCENT)

    c_st_top, c_st_h = create_card_container(s6, Inches(7.13), comp_y, comp_w, comp_h, 
                                             "OUR SOLUTION STANDS OUT (MobTrack - AURA+)", GREEN_TINT, GREEN_BORDER, GREEN_ACCENT)
    tb_st = s6.shapes.add_textbox(Inches(7.21), c_st_top, comp_w - Inches(0.16), c_st_h)
    tf_st = tb_st.text_frame
    tf_st.word_wrap = True
    tf_st.margin_left = tf_st.margin_right = tf_st.margin_top = tf_st.margin_bottom = Inches(0.02)
    add_bullet_point(tf_st, "Dual-Channel Fallback", "Seamlessly operates online via WebSockets and offline via autonomous SMS Relay Gateway.", True, 9.8, GREEN_ACCENT)
    add_bullet_point(tf_st, "Active Thief Trap", "Fake Shutdown deceives the thief into believing the phone is dead while tracking stays 100% alive.", False, 9.8, GREEN_ACCENT)
    add_bullet_point(tf_st, "Court-Ready Forensic Evidence", "Silently captures front-camera selfies and audio recordings to establish the thief's identity.", False, 9.8, GREEN_ACCENT)

    arrow = s6.shapes.add_shape(MSO_SHAPE.RIGHT_ARROW, Inches(6.30), comp_y + Inches(0.65), Inches(0.70), Inches(0.40))
    arrow.fill.solid()
    arrow.fill.fore_color.rgb = BLUE_ACCENT
    arrow.line.color.rgb = BLUE_BORDER

    # Bottom Section: Left Box = Project Resources, Right Box = 2 REAL UI MOCKUP IMAGES!
    bot_y = Inches(4.56)
    bot_h = Inches(2.36)

    c_del_top, c_del_h = create_card_container(s6, Inches(0.40), bot_y, comp_w, bot_h, 
                                               "PROJECT RESOURCES & DELIVERABLES", BLUE_TINT, BLUE_BORDER, BLUE_ACCENT)
    tb_del = s6.shapes.add_textbox(Inches(0.48), c_del_top, comp_w - Inches(0.16), c_del_h)
    tf_del = tb_del.text_frame
    tf_del.word_wrap = True
    tf_del.margin_left = tf_del.margin_right = tf_del.margin_top = tf_del.margin_bottom = Inches(0.02)
    add_bullet_point(tf_del, "Production Android App", "MobTrack-v1.0.26-release.apk compiled and tested on Android 10-15 (Under 42 MB).", True, 9.8, BLUE_ACCENT)
    add_bullet_point(tf_del, "Live Web Dashboard", "Next.js 15 Cyber-Themed Portal with real-time Leaflet GPS radar, remote sirens, and media gallery.", False, 9.8, BLUE_ACCENT)
    add_bullet_point(tf_del, "Standalone Relay Gateway", "Always-Active Android SMS Gateway connecting cloud triggers directly to cellular towers.", False, 9.8, BLUE_ACCENT)
    add_bullet_point(tf_del, "Privacy & Data Isolation", "End-to-End user scoping; private media storage buckets ensure zero teammate data crossover.", False, 9.8, BLUE_ACCENT)

    # Right Card: 2 Real UI Screenshots / Mockups side-by-side (matching sample PDF Page 6 bottom-right!)
    c_ui_top, c_ui_h = create_card_container(s6, Inches(7.13), bot_y, comp_w, bot_h, 
                                             "WORKING PROTOTYPE LIVE UI PREVIEWS", BLUE_TINT, BLUE_BORDER, BLUE_ACCENT)
    
    # 1. Laptop Web Dashboard Mockup
    if os.path.exists(web_mockup_path):
        s6.shapes.add_picture(web_mockup_path, Inches(7.23), c_ui_top + Inches(0.02), Inches(3.20), Inches(1.70))
        lbl1 = s6.shapes.add_textbox(Inches(7.23), c_ui_top + Inches(1.72), Inches(3.20), Inches(0.25))
        p = lbl1.text_frame.paragraphs[0]
        p.text = "Web Dashboard (Radar & Controls)"
        p.font.name = FONT_FAMILY
        p.font.size = Pt(8.5)
        p.font.bold = True
        p.font.color.rgb = BLUE_ACCENT
        p.alignment = PP_ALIGN.CENTER

    # 2. Smartphone Mobile App Mockup
    if os.path.exists(mobile_mockup_path):
        s6.shapes.add_picture(mobile_mockup_path, Inches(10.60), c_ui_top + Inches(0.02), Inches(2.20), Inches(1.70))
        lbl2 = s6.shapes.add_textbox(Inches(10.60), c_ui_top + Inches(1.72), Inches(2.20), Inches(0.25))
        p = lbl2.text_frame.paragraphs[0]
        p.text = "Mobile App (Fake Shutdown)"
        p.font.name = FONT_FAMILY
        p.font.size = Pt(8.5)
        p.font.bold = True
        p.font.color.rgb = GREEN_ACCENT
        p.alignment = PP_ALIGN.CENTER

    # Ensure strictly 6 slides: Remove slide 7
    if len(prs.slides) > 6:
        rId = prs.slides._sldIdLst[6].rId
        prs.part.drop_rel(rId)
        del prs.slides._sldIdLst[6]
        print("Removed instruction slide 7. Total slides is now strictly 6.")

    # Save final presentation
    prs.save(output_pptx)
    print(f"Final presentation saved to: {output_pptx}")

if __name__ == "__main__":
    build_final_ppt()
