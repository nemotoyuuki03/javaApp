import java.awt.Graphics;
import java.awt.Image;
import java.awt.image.BufferedImage;
import java.io.IOException;

import javax.imageio.ImageIO;
import javax.swing.JFrame;

public class DisPlay extends JFrame 
{
    private BufferedImage backgroundImage;
    private BufferedImage foregroundImage;
    private Player player; // Playerオブジェクト

    DisPlay(String name) 
    {
        super(name);
        setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
        setResizable(false); // ウィンドウサイズ変更を無効にする
        setVisible(true);
    }

    void loadBackground(String imagePath) {
        try {
            backgroundImage = ImageIO.read(new java.io.File(imagePath));
            repaint(); // 再描画
        } catch (IOException e) {
            System.err.println("背景画像の読み込みエラー: " + imagePath);
            e.printStackTrace();
        }
    }

    void loadForeground(String imagePath) 
    {
        try 
        {
            foregroundImage = ImageIO.read(new java.io.File(imagePath));
            setSize(800, foregroundImage.getHeight()); // 幅を固定、高さをフロント画像に合わせる
            setLocationRelativeTo(null); // 画面中央に配置
            repaint(); // 再描画
        } 
        catch (IOException e) 
        {
            System.err.println("フロント画像の読み込みエラー: " + imagePath);
            e.printStackTrace();
        }
    }

    void loadPlayer(String imagePath)
    {
        try
        {
            BufferedImage playerImage = ImageIO.read(new java.io.File(imagePath));
            player = new Player(playerImage, 16, 16); // プレイヤーオブジェクトを生成
            repaint(); // 再描画
        } catch (IOException e) 
        {
            System.err.println("プレイヤー画像の読み込みエラー: " + imagePath);
            e.printStackTrace();
        }
    }

    @Override
    public void paint(Graphics g) 
    {
        super.paint(g);
        if (backgroundImage != null) 
        {
            // 背景画像をウィンドウサイズにリサイズ
            Image resizedBackground = backgroundImage.getScaledInstance(getWidth(), getHeight(), Image.SCALE_SMOOTH);
            g.drawImage(resizedBackground, 0, 0, this); // 背景画像を描画
        }
        if (foregroundImage != null) 
        {
            // フロント画像を下に描画
            int y = getHeight() - foregroundImage.getHeight();
            g.drawImage(foregroundImage, 0, y, this); // フロント画像を描画
        }
        if (player != null) 
        {
            player.draw(g, getHeight()); // プレイヤー描画メソッドを呼び出す
        }
    }
}
