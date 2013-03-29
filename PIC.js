/*
JSLinux-deobfuscated - An annotated version of the original JSLinux.

Original is Copyright (c) 2011-2012 Fabrice Bellard
Redistribution or commercial use is prohibited without the author's permission.

8259 PIC (Programmable Interrupt Controller) Emulation Code
*/
function PIC(PC, port_num) {
    PC.register_ioport_write(port_num, 2, 1, this.ioport_write.bind(this));
    PC.register_ioport_read(port_num, 2, 1, this.ioport_read.bind(this));
    this.reset();
}
PIC.prototype.reset = function() {
    this.last_irr = 0;
    this.irr = 0;
    this.imr = 0;
    this.isr = 0;
    this.priority_add = 0;
    this.irq_base = 0;
    this.read_reg_select = 0;
    this.special_mask = 0;
    this.init_state = 0;
    this.auto_eoi = 0;
    this.rotate_on_autoeoi = 0;
    this.init4 = 0;
    this.elcr = 0;
    this.elcr_mask = 0;
};
PIC.prototype.set_irq1 = function(Rg, Qf) {
    var wc;
    wc = 1 << Rg;
    if (Qf) {
        if ((this.last_irr & wc) == 0)
            this.irr |= wc;
        this.last_irr |= wc;
    } else {
        this.last_irr &= ~wc;
    }
};
PIC.prototype.get_priority = function(wc) {
    var Sg;
    if (wc == 0)
        return -1;
    Sg = 7;
    while ((wc & (1 << ((Sg + this.priority_add) & 7))) == 0)
        Sg--;
    return Sg;
};
PIC.prototype.get_irq = function() {
    var wc, Tg, Sg;
    wc = this.irr & ~this.imr;
    Sg = this.get_priority(wc);
    if (Sg < 0)
        return -1;
    Tg = this.get_priority(this.isr);
    if (Sg > Tg) {
        return Sg;
    } else {
        return -1;
    }
};
PIC.prototype.intack = function(Rg) {
    if (this.auto_eoi) {
        if (this.rotate_on_auto_eoi)
            this.priority_add = (Rg + 1) & 7;
    } else {
        this.isr |= (1 << Rg);
    }
    if (!(this.elcr & (1 << Rg)))
        this.irr &= ~(1 << Rg);
};
PIC.prototype.ioport_write = function(mem8_loc, x) {
    var Sg;
    mem8_loc &= 1;
    if (mem8_loc == 0) {
        if (x & 0x10) {
	    /*
	      ICW1
	      // 7:5 = address (if MCS-80/85 mode)
	      // 4 == 1
	      // 3: 1 == level triggered, 0 == edge triggered
	      // 2: 1 == call interval 4, 0 == call interval 8
	      // 1: 1 == single PIC, 0 == cascaded PICs
	      // 0: 1 == send ICW4

	     */
            this.reset();
            this.init_state = 1;
            this.init4 = x & 1;
            if (x & 0x02)
                throw "single mode not supported";
            if (x & 0x08)
                throw "level sensitive irq not supported";
        } else if (x & 0x08) {
            if (x & 0x02)
                this.read_reg_select = x & 1;
            if (x & 0x40)
                this.special_mask = (x >> 5) & 1;
        } else {
            switch (x) {
                case 0x00:
                case 0x80:
                    this.rotate_on_autoeoi = x >> 7;
                    break;
                case 0x20:
                case 0xa0:
                    Sg = this.get_priority(this.isr);
                    if (Sg >= 0) {
                        this.isr &= ~(1 << ((Sg + this.priority_add) & 7));
                    }
                    if (x == 0xa0)
                        this.priority_add = (this.priority_add + 1) & 7;
                    break;
                case 0x60:
                case 0x61:
                case 0x62:
                case 0x63:
                case 0x64:
                case 0x65:
                case 0x66:
                case 0x67:
                    Sg = x & 7;
                    this.isr &= ~(1 << Sg);
                    break;
                case 0xc0:
                case 0xc1:
                case 0xc2:
                case 0xc3:
                case 0xc4:
                case 0xc5:
                case 0xc6:
                case 0xc7:
                    this.priority_add = (x + 1) & 7;
                    break;
                case 0xe0:
                case 0xe1:
                case 0xe2:
                case 0xe3:
                case 0xe4:
                case 0xe5:
                case 0xe6:
                case 0xe7:
                    Sg = x & 7;
                    this.isr &= ~(1 << Sg);
                    this.priority_add = (Sg + 1) & 7;
                    break;
            }
        }
    } else {
        switch (this.init_state) {
            case 0:
                this.imr = x;
                this.update_irq();
                break;
            case 1:
                this.irq_base = x & 0xf8;
                this.init_state = 2;
                break;
            case 2:
                if (this.init4) {
                    this.init_state = 3;
                } else {
                    this.init_state = 0;
                }
                break;
            case 3:
                this.auto_eoi = (x >> 1) & 1;
                this.init_state = 0;
                break;
        }
    }
};
PIC.prototype.ioport_read = function(Ug) {
    var mem8_loc, Pg;
    mem8_loc = Ug & 1;
    if (mem8_loc == 0) {
        if (this.read_reg_select)
            Pg = this.isr;
        else
            Pg = this.irr;
    } else {
        Pg = this.imr;
    }
    return Pg;
};


function PIC_Controller(PC, Wg, Ug, Xg) {
    this.pics = new Array();
    this.pics[0] = new PIC(PC, Wg);
    this.pics[1] = new PIC(PC, Ug);
    this.pics[0].elcr_mask = 0xf8;
    this.pics[1].elcr_mask = 0xde;
    this.irq_requested = 0;
    this.cpu_set_irq = Xg;
    this.pics[0].update_irq = this.update_irq.bind(this);
    this.pics[1].update_irq = this.update_irq.bind(this);
}
PIC_Controller.prototype.update_irq = function() {
    var Yg, Rg;
    Yg = this.pics[1].get_irq();
    if (Yg >= 0) {
        this.pics[0].set_irq1(2, 1);
        this.pics[0].set_irq1(2, 0);
    }
    Rg = this.pics[0].get_irq();
    if (Rg >= 0) {
        this.cpu_set_irq(1);
    } else {
        this.cpu_set_irq(0);
    }
};
PIC_Controller.prototype.set_irq = function(Rg, Qf) {
    this.pics[Rg >> 3].set_irq1(Rg & 7, Qf);
    this.update_irq();
};
PIC_Controller.prototype.get_hard_intno = function() {
    var Rg, Yg, intno;
    Rg = this.pics[0].get_irq();
    if (Rg >= 0) {
        this.pics[0].intack(Rg);
        if (Rg == 2) {
            Yg = this.pics[1].get_irq();
            if (Yg >= 0) {
                this.pics[1].intack(Yg);
            } else {
                Yg = 7;
            }
            intno = this.pics[1].irq_base + Yg;
            Rg = Yg + 8;
        } else {
            intno = this.pics[0].irq_base + Rg;
        }
    } else {
        Rg = 7;
        intno = this.pics[0].irq_base + Rg;
    }
    this.update_irq();
    return intno;
};


